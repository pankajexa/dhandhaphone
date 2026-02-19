// DhandhaDB — SQLite database layer for DhandhaPhone
// Single class wrapping all business data operations

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { openDatabase } = require('./driver');
const { runMigrations } = require('./migrate');

class DhandhaDB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(
      process.env.DHANDHA_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace'),
      'dhandhaphone.db'
    );

    this.db = openDatabase(this.dbPath);
    console.log(`[DB] Opened ${this.dbPath} (${this.db.name})`);

    // Performance + safety pragmas
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');

    // Apply schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);

    // Run migrations
    runMigrations(this.db);
  }

  // ========================================
  // TRANSACTIONS (financial)
  // ========================================

  addTransaction(txn) {
    const stmt = this.db.prepare(`
      INSERT INTO transactions
        (type, amount, counterparty_id, counterparty_name, method,
         source, category, description, reference_id, invoice_number,
         batch_id, original_message, confidence, is_confirmed, transaction_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      txn.type, txn.amount,
      txn.counterparty_id || null, txn.counterparty_name || null,
      txn.method || null, txn.source || 'manual',
      txn.category || null, txn.description || null,
      txn.reference_id || null, txn.invoice_number || null,
      txn.batch_id || null, txn.original_message || null,
      txn.confidence != null ? txn.confidence : 1.0,
      txn.is_confirmed != null ? txn.is_confirmed : 1,
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
    if (filters.counterparty_name) {
      sql += ' AND counterparty_name LIKE ?';
      params.push(`%${filters.counterparty_name}%`);
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
    if (filters.min_amount) {
      sql += ' AND amount >= ?';
      params.push(filters.min_amount);
    }

    sql += ' ORDER BY transaction_date DESC, created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    return this.db.prepare(sql).all(...params);
  }

  updateTransactionCategory(txnId, category) {
    this.db.prepare(`
      UPDATE transactions SET category = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(category, txnId);
  }

  softDeleteTransaction(txnId) {
    this.db.prepare(`
      UPDATE transactions SET is_deleted = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(txnId);
  }

  // ========================================
  // SUMMARIES
  // ========================================

  getDailySummary(date) {
    return this.db.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(amount) as total,
        method,
        category
      FROM transactions
      WHERE transaction_date = ? AND is_deleted = 0
      GROUP BY type, method, category
    `).all(date);
  }

  getDateRangeSummary(fromDate, toDate) {
    return this.db.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(amount) as total
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY type
    `).all(fromDate, toDate);
  }

  getMethodBreakdown(fromDate, toDate) {
    return this.db.prepare(`
      SELECT
        method,
        type,
        COUNT(*) as count,
        SUM(amount) as total
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY method, type
    `).all(fromDate, toDate);
  }

  getTopCounterparties(fromDate, toDate, limit = 10) {
    return this.db.prepare(`
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
      GROUP BY COALESCE(counterparty_id, counterparty_name)
      ORDER BY (total_received + total_paid) DESC
      LIMIT ?
    `).all(fromDate, toDate, limit);
  }

  getRevenueByDay(fromDate, toDate) {
    return this.db.prepare(`
      SELECT
        transaction_date as date,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as revenue,
        SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) as net
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY transaction_date
      ORDER BY transaction_date
    `).all(fromDate, toDate);
  }

  // ========================================
  // CONTACTS
  // ========================================

  addContact(contact) {
    const result = this.db.prepare(`
      INSERT INTO contacts
        (name, name_normalized, phone, email, address, company,
         type, gstin, notes, balance, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contact.name,
      (contact.name || '').toLowerCase().trim(),
      contact.phone || null, contact.email || null,
      contact.address || null, contact.company || null,
      contact.type || 'customer', contact.gstin || null,
      contact.notes || null, contact.balance || 0,
      contact.tags || null
    );
    return result.lastInsertRowid;
  }

  findContact(query) {
    const normalized = (query || '').toLowerCase().trim();
    return this.db.prepare(`
      SELECT * FROM contacts
      WHERE is_deleted = 0
        AND (name_normalized LIKE ?
             OR phone LIKE ?
             OR company LIKE ?)
      LIMIT 10
    `).all(`%${normalized}%`, `%${query}%`, `%${normalized}%`);
  }

  getContact(id) {
    return this.db.prepare(
      'SELECT * FROM contacts WHERE id = ? AND is_deleted = 0'
    ).get(id);
  }

  updateContact(id, fields) {
    const allowed = ['name', 'name_normalized', 'phone', 'email', 'address',
                     'company', 'type', 'gstin', 'notes', 'balance', 'tags'];
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        params.push(v);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    params.push(id);
    this.db.prepare(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`
    ).run(...params);
  }

  updateContactBalance(contactId, delta) {
    this.db.prepare(`
      UPDATE contacts
      SET balance = balance + ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(delta, contactId);
  }

  getReceivables() {
    return this.db.prepare(`
      SELECT
        c.id, c.name, c.phone, c.balance,
        MIN(ce.created_at) as oldest_credit_date,
        CAST(julianday('now') - julianday(MIN(ce.created_at)) AS INTEGER) as days_overdue
      FROM contacts c
      LEFT JOIN credit_entries ce ON ce.contact_id = c.id
        AND ce.is_settled = 0 AND ce.type = 'gave'
      WHERE c.balance > 0 AND c.is_deleted = 0
      GROUP BY c.id
      ORDER BY c.balance DESC
    `).all();
  }

  getPayables() {
    return this.db.prepare(`
      SELECT
        c.id, c.name, c.phone, c.balance
      FROM contacts c
      WHERE c.balance < 0 AND c.is_deleted = 0
      ORDER BY c.balance ASC
    `).all();
  }

  // ========================================
  // CREDIT ENTRIES
  // ========================================

  addCreditEntry(entry) {
    const result = this.db.prepare(`
      INSERT INTO credit_entries
        (contact_id, transaction_id, type, amount, due_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.contact_id, entry.transaction_id || null,
      entry.type, entry.amount,
      entry.due_date || null, entry.notes || null
    );
    return result.lastInsertRowid;
  }

  getCreditEntries(filters = {}) {
    let sql = 'SELECT * FROM credit_entries WHERE is_deleted = 0';
    const params = [];
    if (filters.contact_id) {
      sql += ' AND contact_id = ?';
      params.push(filters.contact_id);
    }
    if (filters.is_settled != null) {
      sql += ' AND is_settled = ?';
      params.push(filters.is_settled);
    }
    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    sql += ' ORDER BY created_at DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    return this.db.prepare(sql).all(...params);
  }

  settleCreditEntry(id) {
    this.db.prepare(`
      UPDATE credit_entries SET is_settled = 1 WHERE id = ?
    `).run(id);
  }

  // ========================================
  // INVENTORY
  // ========================================

  addInventoryItem(item) {
    const result = this.db.prepare(`
      INSERT INTO inventory
        (name, name_normalized, sku, category, unit, quantity,
         min_quantity, purchase_price, selling_price, supplier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name, (item.name || '').toLowerCase().trim(),
      item.sku || null, item.category || null,
      item.unit || null, item.quantity || 0,
      item.min_quantity || null, item.purchase_price || null,
      item.selling_price || null, item.supplier_id || null
    );
    return result.lastInsertRowid;
  }

  getInventoryItem(id) {
    return this.db.prepare(
      'SELECT * FROM inventory WHERE id = ? AND is_deleted = 0'
    ).get(id);
  }

  findInventoryItem(query) {
    const normalized = (query || '').toLowerCase().trim();
    return this.db.prepare(`
      SELECT * FROM inventory
      WHERE is_deleted = 0 AND name_normalized LIKE ?
      LIMIT 10
    `).all(`%${normalized}%`);
  }

  updateInventoryQuantity(id, delta) {
    this.db.prepare(`
      UPDATE inventory
      SET quantity = quantity + ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(delta, id);
  }

  getLowStockItems() {
    return this.db.prepare(`
      SELECT * FROM inventory
      WHERE is_deleted = 0
        AND is_active = 1
        AND min_quantity IS NOT NULL
        AND quantity <= min_quantity
      ORDER BY quantity ASC
    `).all();
  }

  addInventoryMovement(mov) {
    const result = this.db.prepare(`
      INSERT INTO inventory_movements
        (inventory_id, transaction_id, type, quantity, unit_price, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      mov.inventory_id, mov.transaction_id || null,
      mov.type, mov.quantity,
      mov.unit_price || null, mov.notes || null
    );
    return result.lastInsertRowid;
  }

  // ========================================
  // PRICE HISTORY
  // ========================================

  addPriceEntry(entry) {
    const result = this.db.prepare(`
      INSERT INTO price_history
        (inventory_id, item_name, supplier_id, price, unit, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.inventory_id || null, entry.item_name,
      entry.supplier_id || null, entry.price,
      entry.unit || null, entry.source || null
    );
    return result.lastInsertRowid;
  }

  getLatestPrice(itemName) {
    return this.db.prepare(`
      SELECT * FROM price_history
      WHERE item_name = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `).get(itemName);
  }

  getPriceHistory(itemName, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM price_history
      WHERE item_name = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
    `).all(itemName, limit);
  }

  // ========================================
  // DOCUMENTS
  // ========================================

  addDocument(doc) {
    const result = this.db.prepare(`
      INSERT INTO documents
        (type, file_path, raw_text, structured_data,
         transaction_id, contact_id, language, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.type, doc.file_path || null,
      doc.raw_text || null, doc.structured_data ? JSON.stringify(doc.structured_data) : null,
      doc.transaction_id || null, doc.contact_id || null,
      doc.language || null, doc.confidence || null
    );
    return result.lastInsertRowid;
  }

  getDocuments(filters = {}) {
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const params = [];
    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters.contact_id) {
      sql += ' AND contact_id = ?';
      params.push(filters.contact_id);
    }
    sql += ' ORDER BY created_at DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    return this.db.prepare(sql).all(...params);
  }

  // ========================================
  // REMINDERS
  // ========================================

  addReminder(reminder) {
    const result = this.db.prepare(`
      INSERT INTO reminders
        (contact_id, credit_entry_id, amount, message_draft,
         scheduled_at, channel)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      reminder.contact_id, reminder.credit_entry_id || null,
      reminder.amount || null, reminder.message_draft || null,
      reminder.scheduled_at || null, reminder.channel || 'sms'
    );
    return result.lastInsertRowid;
  }

  getPendingReminders() {
    return this.db.prepare(`
      SELECT r.*, c.name as contact_name, c.phone as contact_phone
      FROM reminders r
      JOIN contacts c ON c.id = r.contact_id
      WHERE r.status = 'pending'
      ORDER BY r.scheduled_at ASC
    `).all();
  }

  updateReminderStatus(id, status, sentAt) {
    this.db.prepare(`
      UPDATE reminders SET status = ?, sent_at = ? WHERE id = ?
    `).run(status, sentAt || null, id);
  }

  // ========================================
  // PENDING ACTIONS
  // ========================================

  addPendingAction(action) {
    const result = this.db.prepare(`
      INSERT INTO pending_actions
        (type, target_contact_id, description, due_date, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      action.type, action.target_contact_id || null,
      action.description || null, action.due_date || null,
      action.data ? JSON.stringify(action.data) : null
    );
    return result.lastInsertRowid;
  }

  getPendingActions(filters = {}) {
    let sql = "SELECT * FROM pending_actions WHERE status = 'pending'";
    const params = [];
    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    sql += ' ORDER BY due_date ASC';
    return this.db.prepare(sql).all(...params);
  }

  updateActionStatus(id, status) {
    this.db.prepare(`
      UPDATE pending_actions SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }

  // ========================================
  // CATEGORY RULES
  // ========================================

  addCategoryRule(rule) {
    const result = this.db.prepare(`
      INSERT INTO category_rules (category, match_type, match_value, priority)
      VALUES (?, ?, ?, ?)
    `).run(
      rule.category, rule.match_type || 'keyword',
      rule.match_value, rule.priority || 0
    );
    return result.lastInsertRowid;
  }

  getCategoryRules() {
    return this.db.prepare(
      'SELECT * FROM category_rules ORDER BY priority DESC'
    ).all();
  }

  categorizeTransaction(txn) {
    const rules = this.getCategoryRules();
    const text = `${txn.counterparty_name || ''} ${txn.description || ''} ${txn.method || ''}`.toLowerCase();
    for (const rule of rules) {
      if (rule.match_type === 'keyword' && text.includes(rule.match_value.toLowerCase())) {
        return rule.category;
      }
      if (rule.match_type === 'counterparty' &&
          (txn.counterparty_name || '').toLowerCase().includes(rule.match_value.toLowerCase())) {
        return rule.category;
      }
      if (rule.match_type === 'method' &&
          (txn.method || '').toLowerCase() === rule.match_value.toLowerCase()) {
        return rule.category;
      }
    }
    return null;
  }

  // ========================================
  // FRAUD ALERTS & BASELINES
  // ========================================

  addFraudAlert(alert) {
    const result = this.db.prepare(`
      INSERT INTO fraud_alerts
        (alert_type, severity, description, transaction_id, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      alert.alert_type, alert.severity || 'info',
      alert.description || null, alert.transaction_id || null,
      alert.data ? JSON.stringify(alert.data) : null
    );
    return result.lastInsertRowid;
  }

  getPendingAlerts(severity) {
    let sql = "SELECT * FROM fraud_alerts WHERE status = 'pending'";
    const params = [];
    if (severity) {
      sql += ' AND severity = ?';
      params.push(severity);
    }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params);
  }

  resolveAlert(id) {
    this.db.prepare(`
      UPDATE fraud_alerts
      SET status = 'resolved', resolved_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  getBaseline(key) {
    const row = this.db.prepare(
      'SELECT value FROM fraud_baselines WHERE key = ?'
    ).get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setBaseline(key, value) {
    this.db.prepare(`
      INSERT INTO fraud_baselines (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  // ========================================
  // DEDUPLICATION
  // ========================================

  isDuplicate(amount, date, reference) {
    const raw = `${amount}|${date}|${reference || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return this.db.prepare('SELECT 1 FROM dedup_log WHERE hash = ?').get(hash) !== undefined;
  }

  markProcessed(amount, date, reference, source, transactionId) {
    const raw = `${amount}|${date}|${reference || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    this.db.prepare(`
      INSERT OR IGNORE INTO dedup_log (hash, source, transaction_id)
      VALUES (?, ?, ?)
    `).run(hash, source || null, transactionId || null);
  }

  // ========================================
  // ANON MAP
  // ========================================

  getAnonMapping(category, original) {
    const row = this.db.prepare(
      'SELECT replacement FROM anon_map WHERE category = ? AND original = ?'
    ).get(category, original);
    return row ? row.replacement : null;
  }

  setAnonMapping(category, original, replacement) {
    this.db.prepare(`
      INSERT INTO anon_map (category, original, replacement)
      VALUES (?, ?, ?)
      ON CONFLICT(category, original) DO UPDATE SET replacement = excluded.replacement
    `).run(category, original, replacement);
  }

  getAllAnonMappings() {
    const rows = this.db.prepare('SELECT * FROM anon_map').all();
    const map = { people: {}, phones: {}, accounts: {}, reverse_people: {} };
    for (const row of rows) {
      if (row.category === 'people') {
        map.people[row.original] = row.replacement;
        map.reverse_people[row.replacement] = row.original;
      } else if (row.category === 'phones') {
        map.phones[row.original] = row.replacement;
      } else if (row.category === 'accounts') {
        map.accounts[row.original] = row.replacement;
      }
    }
    return map;
  }

  // ========================================
  // OWNER PROFILE (key-value store)
  // ========================================

  getProfile(key) {
    const row = this.db.prepare(
      'SELECT value FROM owner_profile WHERE key = ?'
    ).get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setProfile(key, value) {
    this.db.prepare(`
      INSERT INTO owner_profile (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  getGSTProfile() {
    return this.getProfile('gst_profile');
  }

  getSmsState() {
    return {
      lastSmsId: this.getProfile('last_sms_id') || 0,
      lastNotificationId: this.getProfile('last_notification_id') || 0,
    };
  }

  setSmsState(key, value) {
    this.setProfile(key, value);
  }

  // ========================================
  // MONTHLY REPORTS
  // ========================================

  saveMonthlyReport(month, reportType, data) {
    this.db.prepare(`
      INSERT INTO monthly_reports (month, report_type, data)
      VALUES (?, ?, ?)
      ON CONFLICT(month, report_type)
      DO UPDATE SET data = excluded.data, created_at = datetime('now')
    `).run(month, reportType, typeof data === 'string' ? data : JSON.stringify(data));
  }

  getMonthlyReport(month, reportType) {
    const row = this.db.prepare(
      'SELECT data FROM monthly_reports WHERE month = ? AND report_type = ?'
    ).get(month, reportType);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return row.data; }
  }

  // ========================================
  // AGENT QUERY (SELECT-only)
  // ========================================

  agentQuery(sql, params = []) {
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) {
      throw new Error('Agent queries must be SELECT only');
    }
    const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER',
                     'CREATE', 'ATTACH', 'DETACH', 'PRAGMA', 'REPLACE'];
    for (const word of blocked) {
      // Match as whole word to avoid false positives in column names
      if (new RegExp(`\\b${word}\\b`).test(trimmed)) {
        throw new Error(`Agent queries cannot contain ${word}`);
      }
    }
    return this.db.prepare(sql).all(...params);
  }

  // ========================================
  // BRAIN: ENTITIES
  // ========================================

  addBrainEntity({ type, name, ref_id, ref_table, properties, confidence }) {
    const result = this.db.prepare(`
      INSERT INTO brain_entities
        (type, name, ref_id, ref_table, properties, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      type, name,
      ref_id || null, ref_table || null,
      JSON.stringify(properties || {}),
      confidence != null ? confidence : 0.5
    );
    return result.lastInsertRowid;
  }

  getBrainEntity(id) {
    const row = this.db.prepare(
      'SELECT * FROM brain_entities WHERE id = ? AND is_active = 1'
    ).get(id);
    if (row) row.properties = JSON.parse(row.properties || '{}');
    return row || null;
  }

  findBrainEntityByRef(refTable, refId) {
    const row = this.db.prepare(
      'SELECT * FROM brain_entities WHERE ref_table = ? AND ref_id = ? AND is_active = 1'
    ).get(refTable, refId);
    if (row) row.properties = JSON.parse(row.properties || '{}');
    return row || null;
  }

  getBrainEntitiesByType(type, opts = {}) {
    const { limit, minConfidence, activeOnly } = opts;
    let sql = 'SELECT * FROM brain_entities WHERE type = ?';
    const params = [type];
    if (activeOnly !== false) {
      sql += ' AND is_active = 1';
    }
    if (minConfidence != null) {
      sql += ' AND confidence >= ?';
      params.push(minConfidence);
    }
    sql += ' ORDER BY updated_at DESC';
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    return this.db.prepare(sql).all(...params).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
  }

  updateBrainEntity(id, fields) {
    const sets = [];
    const params = [];
    if (fields.name !== undefined) {
      sets.push('name = ?');
      params.push(fields.name);
    }
    if (fields.properties !== undefined) {
      sets.push('properties = ?');
      params.push(JSON.stringify(fields.properties));
    }
    if (fields.confidence !== undefined) {
      sets.push('confidence = ?');
      params.push(fields.confidence);
    }
    if (fields.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(fields.is_active);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    params.push(id);
    this.db.prepare(
      `UPDATE brain_entities SET ${sets.join(', ')} WHERE id = ?`
    ).run(...params);
  }

  getBrainEntityContext(entityId) {
    const entity = this.getBrainEntity(entityId);
    if (!entity) return null;
    const edges = this.db.prepare(`
      SELECT e.*, t.name as target_name
      FROM brain_edges e
      LEFT JOIN brain_entities t ON t.id = e.to_entity_id
      WHERE e.from_entity_id = ?
      ORDER BY e.weight DESC
    `).all(entityId).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
    const observations = this.db.prepare(`
      SELECT * FROM brain_observations
      WHERE entity_id = ? AND is_resolved = 0
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY
        CASE type
          WHEN 'anomaly' THEN 1
          WHEN 'intention' THEN 2
          WHEN 'prediction' THEN 3
          WHEN 'insight' THEN 4
          WHEN 'todo' THEN 5
          ELSE 6
        END,
        confidence DESC
      LIMIT 10
    `).all(entityId).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
    return { entity, edges, observations };
  }

  // ========================================
  // BRAIN: EDGES
  // ========================================

  addBrainEdge({ from_entity_id, to_entity_id, type, weight, properties }) {
    const result = this.db.prepare(`
      INSERT INTO brain_edges
        (from_entity_id, to_entity_id, type, weight, properties)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      from_entity_id, to_entity_id || null,
      type, weight != null ? weight : 0.5,
      JSON.stringify(properties || {})
    );
    return result.lastInsertRowid;
  }

  getBrainEdgesFrom(entityId, opts = {}) {
    let sql = `
      SELECT e.*, t.name as target_name
      FROM brain_edges e
      LEFT JOIN brain_entities t ON t.id = e.to_entity_id
      WHERE e.from_entity_id = ?
    `;
    const params = [entityId];
    if (opts.type) {
      sql += ' AND e.type = ?';
      params.push(opts.type);
    }
    sql += ' ORDER BY e.weight DESC';
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    return this.db.prepare(sql).all(...params).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
  }

  getBrainEdgesTo(entityId) {
    return this.db.prepare(`
      SELECT e.*, s.name as source_name
      FROM brain_edges e
      LEFT JOIN brain_entities s ON s.id = e.from_entity_id
      WHERE e.to_entity_id = ?
      ORDER BY e.weight DESC
    `).all(entityId).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
  }

  findBrainEdge(fromId, toId, type) {
    const row = this.db.prepare(
      'SELECT * FROM brain_edges WHERE from_entity_id = ? AND to_entity_id IS ? AND type = ?'
    ).get(fromId, toId, type);
    if (row) row.properties = JSON.parse(row.properties || '{}');
    return row || null;
  }

  updateBrainEdge(id, fields) {
    const sets = [];
    const params = [];
    if (fields.weight !== undefined) {
      sets.push('weight = ?');
      params.push(fields.weight);
    }
    if (fields.properties !== undefined) {
      sets.push('properties = ?');
      params.push(JSON.stringify(fields.properties));
    }
    if (sets.length === 0) return;
    sets.push("last_refreshed = datetime('now')");
    params.push(id);
    this.db.prepare(
      `UPDATE brain_edges SET ${sets.join(', ')} WHERE id = ?`
    ).run(...params);
  }

  decayBrainEdges() {
    const result = this.db.prepare(`
      UPDATE brain_edges
      SET weight = MIN(1.0, MAX(0.1, weight - 0.01 * MAX(0,
        CAST((julianday('now') - julianday(COALESCE(last_refreshed, datetime('now')))) / 7.0 AS REAL)
      ))),
      last_refreshed = datetime('now')
      WHERE weight > 0.1
        AND last_refreshed IS NOT NULL
    `).run();
    return result.changes;
  }

  // ========================================
  // BRAIN: OBSERVATIONS
  // ========================================

  addBrainObservation({ type, entity_id, content, properties, confidence, source, language, expires_at }) {
    const result = this.db.prepare(`
      INSERT INTO brain_observations
        (type, entity_id, content, properties, confidence, source, language, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      type, entity_id || null, content,
      JSON.stringify(properties || {}),
      confidence != null ? confidence : 0.5,
      source || null, language || null, expires_at || null
    );
    return result.lastInsertRowid;
  }

  getActiveObservations(opts = {}) {
    let sql = `
      SELECT * FROM brain_observations
      WHERE is_resolved = 0
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `;
    const params = [];
    if (opts.type) {
      sql += ' AND type = ?';
      params.push(opts.type);
    }
    if (opts.entity_id) {
      sql += ' AND entity_id = ?';
      params.push(opts.entity_id);
    }
    if (opts.minConfidence != null) {
      sql += ' AND confidence >= ?';
      params.push(opts.minConfidence);
    }
    sql += ` ORDER BY
      CASE type
        WHEN 'anomaly' THEN 1
        WHEN 'intention' THEN 2
        WHEN 'prediction' THEN 3
        WHEN 'insight' THEN 4
        WHEN 'todo' THEN 5
        ELSE 6
      END,
      confidence DESC
    `;
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    return this.db.prepare(sql).all(...params).map(row => {
      row.properties = JSON.parse(row.properties || '{}');
      return row;
    });
  }

  resolveBrainObservation(id) {
    this.db.prepare(
      'UPDATE brain_observations SET is_resolved = 1 WHERE id = ?'
    ).run(id);
  }

  sweepExpiredObservations() {
    const result = this.db.prepare(`
      UPDATE brain_observations
      SET is_resolved = 1
      WHERE is_resolved = 0
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')
    `).run();
    return result.changes;
  }

  // ========================================
  // NOTIFICATION LOG
  // ========================================

  logNotification(hash, packageName, status, transactionId = null) {
    this.db.prepare(`
      INSERT OR IGNORE INTO notification_log
      (hash, package_name, status, transaction_id)
      VALUES (?, ?, ?, ?)
    `).run(hash, packageName, status, transactionId);
  }

  getNotificationByHash(hash) {
    return this.db.prepare(
      'SELECT * FROM notification_log WHERE hash = ?'
    ).get(hash) || null;
  }

  getNotificationStats(days = 7) {
    return this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'captured' THEN 1 END) as captured,
        COUNT(CASE WHEN status = 'duplicate' THEN 1 END) as duplicates,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as errors
      FROM notification_log
      WHERE created_at > datetime('now', ? || ' days')
    `).get(-days);
  }

  cleanOldNotificationLogs(days = 30) {
    const result = this.db.prepare(`
      DELETE FROM notification_log
      WHERE created_at < datetime('now', ? || ' days')
    `).run(-days);
    return result.changes;
  }

  // ========================================
  // VPA MAP
  // ========================================

  saveVPAMapping(vpa, contactId, contactName) {
    this.db.prepare(`
      INSERT OR REPLACE INTO vpa_map (vpa, contact_id, contact_name)
      VALUES (?, ?, ?)
    `).run(vpa, contactId, contactName);
  }

  resolveVPA(vpa) {
    return this.db.prepare(
      'SELECT * FROM vpa_map WHERE vpa = ?'
    ).get(vpa) || null;
  }

  getVPAsByContact(contactId) {
    return this.db.prepare(
      'SELECT * FROM vpa_map WHERE contact_id = ?'
    ).all(contactId);
  }

  // ========================================
  // DEDUP LOG (cross-channel deduplication)
  // ========================================

  addDedupEntry(hash, source, transactionId) {
    this.db.prepare(`
      INSERT OR IGNORE INTO dedup_log (hash, source, transaction_id)
      VALUES (?, ?, ?)
    `).run(hash, source, transactionId);
  }

  getDedupByHash(hash) {
    return this.db.prepare(
      'SELECT * FROM dedup_log WHERE hash = ?'
    ).get(hash) || null;
  }

  // ========================================
  // MAINTENANCE
  // ========================================

  backup(destPath) {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(this.dbPath, destPath);
    console.log(`[DB] Backup saved to ${destPath}`);
  }

  close() {
    this.db.close();
    console.log('[DB] Closed');
  }
}

module.exports = { DhandhaDB };
