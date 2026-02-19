#!/usr/bin/env node
// Test suite for DhandhaDB
// Run: node lib/db/test-db.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { DhandhaDB } = require('./db');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhandha-test-'));
const dbPath = path.join(testDir, 'test.db');

let passed = 0;
let failed = 0;
let db;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg} (expected ${expected}, got ${actual})`);
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

try {
  // ========================================
  section('Initialization');
  // ========================================
  db = new DhandhaDB(dbPath);
  assert(db !== null, 'DB opens without error');
  assert(fs.existsSync(dbPath), 'DB file created on disk');

  // ========================================
  section('Contacts');
  // ========================================
  const c1 = db.addContact({ name: 'Sharma Traders', phone: '+919876543210', type: 'customer' });
  assert(c1 > 0, 'addContact returns ID');

  const c2 = db.addContact({ name: 'Krishna Suppliers', phone: '+919123456789', type: 'supplier', balance: -5000 });
  assert(c2 > 0, 'addContact second contact');

  const found = db.findContact('sharma');
  assertEq(found.length, 1, 'findContact by name');
  assertEq(found[0].name, 'Sharma Traders', 'findContact returns correct name');

  const foundByPhone = db.findContact('9876543210');
  assertEq(foundByPhone.length, 1, 'findContact by phone');

  const got = db.getContact(c1);
  assertEq(got.name, 'Sharma Traders', 'getContact by ID');

  db.updateContact(c1, { notes: 'Regular customer' });
  const updated = db.getContact(c1);
  assertEq(updated.notes, 'Regular customer', 'updateContact');

  db.updateContactBalance(c1, 1000);
  const bal = db.getContact(c1);
  assertEq(bal.balance, 1000, 'updateContactBalance');

  const receivables = db.getReceivables();
  assertEq(receivables.length, 1, 'getReceivables shows Sharma');

  const payables = db.getPayables();
  assertEq(payables.length, 1, 'getPayables shows Krishna');

  // ========================================
  section('Transactions');
  // ========================================
  const t1 = db.addTransaction({
    type: 'credit', amount: 5000, counterparty_id: c1,
    counterparty_name: 'Sharma Traders', method: 'UPI',
    source: 'sms', reference_id: '123456789012',
    transaction_date: '2026-02-18'
  });
  assert(t1 > 0, 'addTransaction returns ID');

  const t2 = db.addTransaction({
    type: 'debit', amount: 3000, counterparty_id: c2,
    counterparty_name: 'Krishna Suppliers', method: 'CASH',
    source: 'manual', category: 'purchase',
    transaction_date: '2026-02-18'
  });
  assert(t2 > 0, 'addTransaction debit');

  const t3 = db.addTransaction({
    type: 'credit', amount: 2000, counterparty_name: 'Walk-in',
    method: 'CASH', source: 'manual',
    transaction_date: '2026-02-17'
  });
  assert(t3 > 0, 'addTransaction without counterparty_id');

  const allTxns = db.getTransactions();
  assertEq(allTxns.length, 3, 'getTransactions returns all');

  const credits = db.getTransactions({ type: 'credit' });
  assertEq(credits.length, 2, 'getTransactions filter by type');

  const byDate = db.getTransactions({ from_date: '2026-02-18', to_date: '2026-02-18' });
  assertEq(byDate.length, 2, 'getTransactions filter by date');

  const byName = db.getTransactions({ counterparty_name: 'Sharma' });
  assertEq(byName.length, 1, 'getTransactions filter by counterparty_name');

  const byMin = db.getTransactions({ min_amount: 4000 });
  assertEq(byMin.length, 1, 'getTransactions filter by min_amount');

  const limited = db.getTransactions({ limit: 1 });
  assertEq(limited.length, 1, 'getTransactions with limit');

  db.updateTransactionCategory(t1, 'sale');
  const catTxn = db.getTransactions({ category: 'sale' });
  assertEq(catTxn.length, 1, 'updateTransactionCategory');

  db.softDeleteTransaction(t3);
  const afterDelete = db.getTransactions();
  assertEq(afterDelete.length, 2, 'softDeleteTransaction hides from results');

  // ========================================
  section('Summaries');
  // ========================================
  const daily = db.getDailySummary('2026-02-18');
  assert(daily.length > 0, 'getDailySummary returns data');

  const range = db.getDateRangeSummary('2026-02-01', '2026-02-28');
  assert(range.length > 0, 'getDateRangeSummary returns data');

  const methods = db.getMethodBreakdown('2026-02-01', '2026-02-28');
  assert(methods.length > 0, 'getMethodBreakdown returns data');

  const topCp = db.getTopCounterparties('2026-02-01', '2026-02-28');
  assert(topCp.length > 0, 'getTopCounterparties returns data');

  const revenue = db.getRevenueByDay('2026-02-01', '2026-02-28');
  assert(revenue.length > 0, 'getRevenueByDay returns data');

  // ========================================
  section('Credit Entries');
  // ========================================
  const ce1 = db.addCreditEntry({
    contact_id: c1, type: 'gave', amount: 10000,
    due_date: '2026-03-01', notes: 'Monthly credit'
  });
  assert(ce1 > 0, 'addCreditEntry returns ID');

  const entries = db.getCreditEntries({ contact_id: c1 });
  assertEq(entries.length, 1, 'getCreditEntries by contact');

  const unsettled = db.getCreditEntries({ is_settled: 0 });
  assertEq(unsettled.length, 1, 'getCreditEntries unsettled');

  db.settleCreditEntry(ce1);
  const settled = db.getCreditEntries({ is_settled: 1 });
  assertEq(settled.length, 1, 'settleCreditEntry');

  // ========================================
  section('Inventory');
  // ========================================
  const inv1 = db.addInventoryItem({
    name: 'Basmati Rice 25kg', unit: 'bags',
    quantity: 50, min_quantity: 10,
    purchase_price: 1200, selling_price: 1500
  });
  assert(inv1 > 0, 'addInventoryItem returns ID');

  const invItem = db.getInventoryItem(inv1);
  assertEq(invItem.name, 'Basmati Rice 25kg', 'getInventoryItem');

  const invSearch = db.findInventoryItem('basmati');
  assertEq(invSearch.length, 1, 'findInventoryItem');

  db.updateInventoryQuantity(inv1, -5);
  const updatedInv = db.getInventoryItem(inv1);
  assertEq(updatedInv.quantity, 45, 'updateInventoryQuantity');

  // Add low-stock item
  const inv2 = db.addInventoryItem({
    name: 'Sugar 1kg', unit: 'pcs', quantity: 3, min_quantity: 5
  });
  const lowStock = db.getLowStockItems();
  assertEq(lowStock.length, 1, 'getLowStockItems');
  assertEq(lowStock[0].name, 'Sugar 1kg', 'getLowStockItems correct item');

  const mov1 = db.addInventoryMovement({
    inventory_id: inv1, type: 'out', quantity: 2, unit_price: 1500
  });
  assert(mov1 > 0, 'addInventoryMovement');

  // ========================================
  section('Price History');
  // ========================================
  const p1 = db.addPriceEntry({
    item_name: 'Basmati Rice 25kg', price: 1200,
    unit: 'bag', source: 'manual'
  });
  assert(p1 > 0, 'addPriceEntry');

  db.addPriceEntry({
    item_name: 'Basmati Rice 25kg', price: 1250,
    unit: 'bag', source: 'invoice_ocr'
  });

  const latest = db.getLatestPrice('Basmati Rice 25kg');
  assertEq(latest.price, 1250, 'getLatestPrice returns most recent');

  const history = db.getPriceHistory('Basmati Rice 25kg');
  assertEq(history.length, 2, 'getPriceHistory returns all entries');

  // ========================================
  section('Documents');
  // ========================================
  const doc1 = db.addDocument({
    type: 'invoice', file_path: '/ocr/inv001.jpg',
    raw_text: 'Invoice from Krishna Suppliers', language: 'en',
    structured_data: { vendor: 'Krishna', total: 15000 }
  });
  assert(doc1 > 0, 'addDocument');

  const docs = db.getDocuments({ type: 'invoice' });
  assertEq(docs.length, 1, 'getDocuments');

  // ========================================
  section('Reminders');
  // ========================================
  const rem1 = db.addReminder({
    contact_id: c1, amount: 10000,
    message_draft: 'Sharma ji, payment pending',
    scheduled_at: '2026-03-01'
  });
  assert(rem1 > 0, 'addReminder');

  const pending = db.getPendingReminders();
  assertEq(pending.length, 1, 'getPendingReminders');
  assertEq(pending[0].contact_name, 'Sharma Traders', 'getPendingReminders includes contact name');

  db.updateReminderStatus(rem1, 'sent', new Date().toISOString());
  const afterSend = db.getPendingReminders();
  assertEq(afterSend.length, 0, 'updateReminderStatus removes from pending');

  // ========================================
  section('Pending Actions');
  // ========================================
  const act1 = db.addPendingAction({
    type: 'payment_reminder', target_contact_id: c1,
    description: 'Follow up on payment', due_date: '2026-03-01'
  });
  assert(act1 > 0, 'addPendingAction');

  const actions = db.getPendingActions();
  assertEq(actions.length, 1, 'getPendingActions');

  db.updateActionStatus(act1, 'done');
  const afterDone = db.getPendingActions();
  assertEq(afterDone.length, 0, 'updateActionStatus clears pending');

  // ========================================
  section('Category Rules');
  // ========================================
  db.addCategoryRule({ category: 'purchase', match_type: 'counterparty', match_value: 'Krishna', priority: 10 });
  db.addCategoryRule({ category: 'rent', match_type: 'keyword', match_value: 'rent', priority: 5 });

  const rules = db.getCategoryRules();
  assertEq(rules.length, 2, 'getCategoryRules');
  assertEq(rules[0].category, 'purchase', 'getCategoryRules ordered by priority');

  const cat1 = db.categorizeTransaction({ counterparty_name: 'Krishna Suppliers' });
  assertEq(cat1, 'purchase', 'categorizeTransaction by counterparty');

  const cat2 = db.categorizeTransaction({ description: 'Monthly rent payment' });
  assertEq(cat2, 'rent', 'categorizeTransaction by keyword');

  const cat3 = db.categorizeTransaction({ description: 'Random stuff' });
  assertEq(cat3, null, 'categorizeTransaction returns null on no match');

  // ========================================
  section('Fraud Alerts & Baselines');
  // ========================================
  const fa1 = db.addFraudAlert({
    alert_type: 'duplicate_amount', severity: 'yellow',
    description: 'Same amount twice in 5 min', transaction_id: t1
  });
  assert(fa1 > 0, 'addFraudAlert');

  const alerts = db.getPendingAlerts();
  assertEq(alerts.length, 1, 'getPendingAlerts');

  const yellowAlerts = db.getPendingAlerts('yellow');
  assertEq(yellowAlerts.length, 1, 'getPendingAlerts filtered by severity');

  db.resolveAlert(fa1);
  const afterResolve = db.getPendingAlerts();
  assertEq(afterResolve.length, 0, 'resolveAlert clears pending');

  db.setBaseline('avg_daily_revenue', { amount: 15000, count: 10 });
  const baseline = db.getBaseline('avg_daily_revenue');
  assertEq(baseline.amount, 15000, 'setBaseline + getBaseline');

  // ========================================
  section('Deduplication');
  // ========================================
  assert(!db.isDuplicate(5000, '2026-02-18', 'REF001'), 'isDuplicate false for new');
  db.markProcessed(5000, '2026-02-18', 'REF001', 'sms', t1);
  assert(db.isDuplicate(5000, '2026-02-18', 'REF001'), 'isDuplicate true after markProcessed');
  assert(!db.isDuplicate(5000, '2026-02-18', 'REF002'), 'isDuplicate false for different ref');

  // ========================================
  section('Anon Map');
  // ========================================
  db.setAnonMapping('people', 'Sharma Traders', 'C-001');
  db.setAnonMapping('phones', '+919876543210', 'PHONE-001');

  assertEq(db.getAnonMapping('people', 'Sharma Traders'), 'C-001', 'getAnonMapping');

  const fullMap = db.getAllAnonMappings();
  assertEq(fullMap.people['Sharma Traders'], 'C-001', 'getAllAnonMappings people');
  assertEq(fullMap.reverse_people['C-001'], 'Sharma Traders', 'getAllAnonMappings reverse');
  assertEq(fullMap.phones['+919876543210'], 'PHONE-001', 'getAllAnonMappings phones');

  // ========================================
  section('Owner Profile');
  // ========================================
  db.setProfile('business_name', 'Sharma General Store');
  assertEq(db.getProfile('business_name'), 'Sharma General Store', 'setProfile + getProfile string');

  db.setProfile('gst_profile', { gstin: '27AADCB2230M1Z3', scheme: 'regular' });
  const gst = db.getGSTProfile();
  assertEq(gst.gstin, '27AADCB2230M1Z3', 'getGSTProfile');

  db.setSmsState('last_sms_id', 42);
  const smsState = db.getSmsState();
  assertEq(smsState.lastSmsId, 42, 'getSmsState');

  // ========================================
  section('Monthly Reports');
  // ========================================
  db.saveMonthlyReport('2026-02', 'pnl', { revenue: 100000, expenses: 60000, profit: 40000 });
  const pnl = db.getMonthlyReport('2026-02', 'pnl');
  assertEq(pnl.profit, 40000, 'saveMonthlyReport + getMonthlyReport');

  // Upsert
  db.saveMonthlyReport('2026-02', 'pnl', { revenue: 110000, expenses: 65000, profit: 45000 });
  const pnl2 = db.getMonthlyReport('2026-02', 'pnl');
  assertEq(pnl2.profit, 45000, 'saveMonthlyReport upsert');

  // ========================================
  section('Agent Query Safety');
  // ========================================
  const qResult = db.agentQuery('SELECT COUNT(*) as cnt FROM transactions WHERE is_deleted = 0');
  assertEq(qResult[0].cnt, 2, 'agentQuery SELECT works');

  const safetyTests = [
    ['INSERT INTO contacts (name) VALUES ("hack")', 'INSERT'],
    ['SELECT 1; DROP TABLE contacts', 'DROP'],
    ['UPDATE contacts SET name = "hack"', 'UPDATE'],
    ['DELETE FROM contacts', 'DELETE'],
    ['SELECT 1; ALTER TABLE contacts ADD COLUMN x TEXT', 'ALTER'],
    ['ATTACH DATABASE "x.db" AS x', 'ATTACH'],
    ['PRAGMA table_info(contacts)', 'PRAGMA'],
  ];

  for (const [sql, keyword] of safetyTests) {
    try {
      db.agentQuery(sql);
      assert(false, `agentQuery blocks ${keyword}`);
    } catch (e) {
      assert(e.message.includes(keyword) || e.message.includes('SELECT'), `agentQuery blocks ${keyword}`);
    }
  }

  // ========================================
  section('Brain: Entities');
  // ========================================
  const be1 = db.addBrainEntity({
    type: 'customer_profile', name: 'Sharma Profile',
    ref_id: c1, ref_table: 'contacts',
    properties: { avg_order: 5000, payment_day: 15, reliability: 0.8 },
    confidence: 0.7
  });
  assert(be1 > 0, 'addBrainEntity returns ID');

  const be2 = db.addBrainEntity({
    type: 'supplier_profile', name: 'Krishna Profile',
    ref_id: c2, ref_table: 'contacts',
    properties: { avg_delivery_days: 3 }
  });
  assert(be2 > 0, 'addBrainEntity second entity');

  const be3 = db.addBrainEntity({
    type: 'business_snapshot', name: 'Daily Snapshot',
    properties: { daily_avg_revenue: 8200 }
  });
  assert(be3 > 0, 'addBrainEntity without ref');

  const gotEntity = db.getBrainEntity(be1);
  assertEq(gotEntity.name, 'Sharma Profile', 'getBrainEntity by ID');
  assertEq(gotEntity.properties.avg_order, 5000, 'getBrainEntity parses properties');
  assertEq(gotEntity.confidence, 0.7, 'getBrainEntity confidence');

  const byRef = db.findBrainEntityByRef('contacts', c1);
  assertEq(byRef.id, be1, 'findBrainEntityByRef');

  const byType = db.getBrainEntitiesByType('customer_profile');
  assertEq(byType.length, 1, 'getBrainEntitiesByType');

  const byTypeMinConf = db.getBrainEntitiesByType('customer_profile', { minConfidence: 0.9 });
  assertEq(byTypeMinConf.length, 0, 'getBrainEntitiesByType with minConfidence filters');

  db.updateBrainEntity(be1, { properties: { avg_order: 6000, reliability: 0.9 }, confidence: 0.8 });
  const updatedEntity = db.getBrainEntity(be1);
  assertEq(updatedEntity.properties.avg_order, 6000, 'updateBrainEntity properties');
  assertEq(updatedEntity.confidence, 0.8, 'updateBrainEntity confidence');

  const ctx = db.getBrainEntityContext(be1);
  assertEq(ctx.entity.id, be1, 'getBrainEntityContext returns entity');
  assert(Array.isArray(ctx.edges), 'getBrainEntityContext returns edges array');
  assert(Array.isArray(ctx.observations), 'getBrainEntityContext returns observations array');

  // Deactivate and verify
  db.updateBrainEntity(be3, { is_active: 0 });
  const deactivated = db.getBrainEntity(be3);
  assertEq(deactivated, null, 'getBrainEntity returns null for inactive');

  // activeOnly: false should still find inactive entities
  const withInactive = db.getBrainEntitiesByType('business_snapshot', { activeOnly: false });
  assertEq(withInactive.length, 1, 'getBrainEntitiesByType activeOnly:false finds inactive');

  // getBrainEntityContext for nonexistent entity
  assertEq(db.getBrainEntityContext(99999), null, 'getBrainEntityContext returns null for missing');

  // findBrainEdge for nonexistent type
  assertEq(db.findBrainEdge(be1, be2, 'nonexistent'), null, 'findBrainEdge returns null for missing');

  // ========================================
  section('Brain: Edges');
  // ========================================
  const edge1 = db.addBrainEdge({
    from_entity_id: be1, to_entity_id: be2,
    type: 'buys_from', weight: 0.8,
    properties: { frequency: 'weekly' }
  });
  assert(edge1 > 0, 'addBrainEdge returns ID');

  const edgesFrom = db.getBrainEdgesFrom(be1);
  assertEq(edgesFrom.length, 1, 'getBrainEdgesFrom');
  assertEq(edgesFrom[0].target_name, 'Krishna Profile', 'getBrainEdgesFrom JOINs target name');
  assertEq(edgesFrom[0].properties.frequency, 'weekly', 'getBrainEdgesFrom parses properties');

  const edgesTo = db.getBrainEdgesTo(be2);
  assertEq(edgesTo.length, 1, 'getBrainEdgesTo');
  assertEq(edgesTo[0].source_name, 'Sharma Profile', 'getBrainEdgesTo JOINs source name');

  const foundEdge = db.findBrainEdge(be1, be2, 'buys_from');
  assertEq(foundEdge.id, edge1, 'findBrainEdge');

  db.updateBrainEdge(edge1, { weight: 0.9, properties: { frequency: 'daily' } });
  const updatedEdge = db.findBrainEdge(be1, be2, 'buys_from');
  assertEq(updatedEdge.weight, 0.9, 'updateBrainEdge weight');
  assertEq(updatedEdge.properties.frequency, 'daily', 'updateBrainEdge properties');

  // Set last_refreshed to 30 days ago to test real decay
  db.db.prepare(
    "UPDATE brain_edges SET last_refreshed = datetime('now', '-30 days') WHERE id = ?"
  ).run(edge1);
  const preDecayWeight = db.findBrainEdge(be1, be2, 'buys_from').weight;
  const decayed = db.decayBrainEdges();
  assert(decayed >= 1, 'decayBrainEdges reports changes');
  const postDecayWeight = db.findBrainEdge(be1, be2, 'buys_from').weight;
  assert(postDecayWeight < preDecayWeight, 'decayBrainEdges actually reduces weight');
  assert(postDecayWeight >= 0.1, 'decayBrainEdges respects minimum weight');

  // Calling decay again immediately should NOT meaningfully reduce (last_refreshed was reset)
  const postDecayWeight2 = db.findBrainEdge(be1, be2, 'buys_from').weight;
  db.decayBrainEdges();
  const postDecayWeight3 = db.findBrainEdge(be1, be2, 'buys_from').weight;
  // Allow tiny float drift from sub-second datetime('now') difference
  assert(Math.abs(postDecayWeight3 - postDecayWeight2) < 0.001, 'decayBrainEdges does not double-decay');

  // ========================================
  section('Brain: Observations');
  // ========================================
  const obs1 = db.addBrainObservation({
    type: 'anomaly', entity_id: be1,
    content: 'Revenue drop 60% from yesterday',
    properties: { drop_pct: 60 },
    confidence: 0.9, source: 'heartbeat'
  });
  assert(obs1 > 0, 'addBrainObservation returns ID');

  const obs2 = db.addBrainObservation({
    type: 'insight', entity_id: be1,
    content: 'Sharma orders increase before festivals',
    confidence: 0.7, source: 'analysis'
  });

  const obs3 = db.addBrainObservation({
    type: 'todo', content: 'Check GSTR-1 filing',
    source: 'calendar',
    expires_at: '2020-01-01T00:00:00' // already expired
  });

  const activeObs = db.getActiveObservations({ limit: 10 });
  assertEq(activeObs.length, 2, 'getActiveObservations returns exactly 2 active observations');
  assertEq(activeObs[0].type, 'anomaly', 'getActiveObservations prioritizes anomalies');

  const obsForEntity = db.getActiveObservations({ entity_id: be1 });
  assertEq(obsForEntity.length, 2, 'getActiveObservations filters by entity_id');

  db.resolveBrainObservation(obs1);
  const afterResolve2 = db.getActiveObservations({ entity_id: be1 });
  assertEq(afterResolve2.length, 1, 'resolveBrainObservation removes from active');

  const swept = db.sweepExpiredObservations();
  assertEq(swept, 1, 'sweepExpiredObservations resolves exactly 1 expired');

  const afterSweep = db.getActiveObservations();
  assertEq(afterSweep.length, 1, 'After sweep, exactly 1 observation remains (obs2)');
  assertEq(afterSweep[0].id, obs2, 'Remaining observation is obs2 (insight)');

  // ========================================
  section('Notification Log');
  // ========================================
  db.logNotification('abc123hash', 'com.google.android.apps.nbu.paisa.user', 'captured', 1);
  db.logNotification('def456hash', 'com.phonepe.app', 'duplicate', null);
  db.logNotification('ghi789hash', 'com.google.android.apps.nbu.paisa.user', 'skipped', null);

  const notifLookup = db.getNotificationByHash('abc123hash');
  assert(notifLookup !== null, 'getNotificationByHash finds entry');
  assertEq(notifLookup.package_name, 'com.google.android.apps.nbu.paisa.user', 'notif log has correct package');
  assertEq(notifLookup.status, 'captured', 'notif log has correct status');
  assertEq(notifLookup.transaction_id, 1, 'notif log has correct transaction_id');

  const notifMiss = db.getNotificationByHash('nonexistent');
  assertEq(notifMiss, null, 'getNotificationByHash returns null for missing');

  // Duplicate insert should be ignored (INSERT OR IGNORE)
  db.logNotification('abc123hash', 'com.google.android.apps.nbu.paisa.user', 'error', null);
  const notifStillCaptured = db.getNotificationByHash('abc123hash');
  assertEq(notifStillCaptured.status, 'captured', 'duplicate logNotification is ignored');

  const stats = db.getNotificationStats(7);
  assertEq(stats.captured, 1, 'notif stats captured count');
  assertEq(stats.duplicates, 1, 'notif stats duplicates count');
  assertEq(stats.skipped, 1, 'notif stats skipped count');

  // ========================================
  section('VPA Map');
  // ========================================
  db.saveVPAMapping('rajan@ybl', c1, 'Test Customer');
  db.saveVPAMapping('supplier@paytm', c2, 'Test Supplier');

  const resolved = db.resolveVPA('rajan@ybl');
  assert(resolved !== null, 'resolveVPA finds mapping');
  assertEq(resolved.contact_id, c1, 'VPA maps to correct contact');
  assertEq(resolved.contact_name, 'Test Customer', 'VPA has contact name');

  const missingVPA = db.resolveVPA('unknown@upi');
  assertEq(missingVPA, null, 'resolveVPA returns null for unknown VPA');

  const vpas = db.getVPAsByContact(c1);
  assertEq(vpas.length, 1, 'getVPAsByContact returns correct count');
  assertEq(vpas[0].vpa, 'rajan@ybl', 'getVPAsByContact has correct VPA');

  // Upsert: update existing VPA mapping
  db.saveVPAMapping('rajan@ybl', c1, 'Updated Name');
  const vpaUpdated = db.resolveVPA('rajan@ybl');
  assertEq(vpaUpdated.contact_name, 'Updated Name', 'VPA mapping upsert works');

  // ========================================
  section('Dedup Log');
  // ========================================
  db.addDedupEntry('deduphash1', 'sms', 1);
  const dedupLookup = db.getDedupByHash('deduphash1');
  assert(dedupLookup !== null, 'getDedupByHash finds entry');
  assertEq(dedupLookup.source, 'sms', 'dedup entry has correct source');

  const dedupMiss = db.getDedupByHash('nonexistent');
  assertEq(dedupMiss, null, 'getDedupByHash returns null for missing');

  // Duplicate should be ignored
  db.addDedupEntry('deduphash1', 'notification', 2);
  const dedupStill = db.getDedupByHash('deduphash1');
  assertEq(dedupStill.source, 'sms', 'duplicate dedup entry is ignored');

  // ========================================
  section('Notification Log Cleanup');
  // ========================================
  // Insert an old entry manually
  db.db.prepare(`
    INSERT INTO notification_log (hash, package_name, status, created_at)
    VALUES ('old_hash', 'com.test', 'captured', datetime('now', '-60 days'))
  `).run();
  const cleaned = db.cleanOldNotificationLogs(30);
  assertEq(cleaned, 1, 'cleanOldNotificationLogs removes old entries');
  const oldEntry = db.getNotificationByHash('old_hash');
  assertEq(oldEntry, null, 'old entry is actually deleted');

  // Recent entries should survive
  const recentEntry = db.getNotificationByHash('abc123hash');
  assert(recentEntry !== null, 'recent entries survive cleanup');

  // ========================================
  section('Migration Idempotency');
  // ========================================
  // Creating a second DhandhaDB on the same file should be safe
  const db2 = new DhandhaDB(dbPath);
  const txns2 = db2.getTransactions();
  assertEq(txns2.length, 2, 'Re-open DB preserves data');
  db2.close();

  // ========================================
  section('Backup');
  // ========================================
  const backupPath = path.join(testDir, 'backup.db');
  db.backup(backupPath);
  assert(fs.existsSync(backupPath), 'backup creates file');
  const backupSize = fs.statSync(backupPath).size;
  assert(backupSize > 0, 'backup file is not empty');

  // Verify backup is valid by opening it
  const db3 = new DhandhaDB(backupPath);
  const backupTxns = db3.getTransactions();
  assertEq(backupTxns.length, 2, 'backup DB has same data');
  db3.close();

} catch (e) {
  console.error('\nUNEXPECTED ERROR:', e);
  failed++;
} finally {
  if (db) db.close();
  // Cleanup
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`========================================`);
process.exit(failed > 0 ? 1 : 0);
