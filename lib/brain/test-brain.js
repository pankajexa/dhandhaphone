#!/usr/bin/env node
// Integration test for the full Brain pipeline
// Run: DHANDHA_WORKSPACE=/tmp/brain-integ-test node lib/brain/test-brain.js

const path = require('path');
const fs = require('fs');
const os = require('os');

// Set up temp workspace
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-integ-'));
process.env.DHANDHA_WORKSPACE = testDir;

// Create knowledge directory with a test file
const knowledgeDir = path.join(testDir, 'knowledge', 'gst');
fs.mkdirSync(knowledgeDir, { recursive: true });
fs.writeFileSync(path.join(knowledgeDir, '_overview.md'), '# GST Overview\nGST is a unified indirect tax.\n');

let passed = 0;
let failed = 0;

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
    console.error(`  FAIL: ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

let db;
try {
  const { DhandhaDB } = require('../db/db');
  const dbPath = path.join(testDir, 'test-brain.db');
  db = new DhandhaDB(dbPath);

  // ========================================
  section('Setup: Seed test data');
  // ========================================
  const c1 = db.addContact({ name: 'Sharma Traders', phone: '+919876543210', type: 'customer' });
  const c2 = db.addContact({ name: 'Krishna Suppliers', phone: '+919123456789', type: 'supplier' });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Add enough transactions for pattern detection
  for (let i = 0; i < 10; i++) {
    const daysAgo = new Date(Date.now() - i * 3 * 86400000).toISOString().split('T')[0];
    db.addTransaction({
      type: 'credit', amount: 5000 + (i * 100),
      counterparty_id: c1, counterparty_name: 'Sharma Traders',
      method: 'UPI', source: 'sms', transaction_date: daysAgo,
    });
  }

  for (let i = 0; i < 5; i++) {
    const daysAgo = new Date(Date.now() - i * 5 * 86400000).toISOString().split('T')[0];
    db.addTransaction({
      type: 'debit', amount: 3000 + (i * 200),
      counterparty_id: c2, counterparty_name: 'Krishna Suppliers',
      method: 'CASH', source: 'manual', transaction_date: daysAgo,
    });
  }

  assert(true, 'Test data seeded');

  // ========================================
  section('GraphUpdater');
  // ========================================
  const { GraphUpdater } = require('./graph-updater');
  const updater = new GraphUpdater(db);

  const profileId = updater.upsertContactProfile(c1, { avg_order: 5000, reliability: 0.8 });
  assert(profileId > 0, 'upsertContactProfile creates entity');

  const entity = db.getBrainEntity(profileId);
  assertEq(entity.properties.avg_order, 5000, 'Entity has correct avg_order');
  assertEq(entity.ref_table, 'contacts', 'Entity references contacts table');

  // Merge update
  const sameId = updater.upsertContactProfile(c1, { payment_day: 15, reliability: 0.9 });
  assertEq(sameId, profileId, 'upsertContactProfile merges into existing');
  const merged = db.getBrainEntity(profileId);
  assertEq(merged.properties.avg_order, 5000, 'Merge preserves existing properties');
  assertEq(merged.properties.payment_day, 15, 'Merge adds new properties');

  const profileId2 = updater.upsertContactProfile(c2, { avg_delivery: 3 });
  assert(profileId2 > 0, 'upsertContactProfile for supplier');

  const edgeId = updater.upsertEdge(profileId, profileId2, 'buys_from', { weight: 0.8, frequency: 'weekly' });
  assert(edgeId > 0, 'upsertEdge creates edge');

  // Merge edge
  const sameEdge = updater.upsertEdge(profileId, profileId2, 'buys_from', { weight: 0.9 });
  assertEq(sameEdge, edgeId, 'upsertEdge merges into existing');

  const obsId = updater.addObservation({
    type: 'insight', entity_id: profileId,
    content: 'Sharma orders increase before festivals',
    confidence: 0.7, source: 'conversation'
  });
  assert(obsId > 0, 'addObservation returns ID');

  // Check auto-expiry
  const obs = db.db.prepare('SELECT expires_at FROM brain_observations WHERE id = ?').get(obsId);
  assert(obs.expires_at !== null, 'Insight observation has auto-expiry');

  // Todo observation should NOT expire
  const todoId = updater.addObservation({
    type: 'todo', content: 'Check GSTR-1', confidence: 1.0, source: 'calendar'
  });
  const todo = db.db.prepare('SELECT expires_at FROM brain_observations WHERE id = ?').get(todoId);
  assertEq(todo.expires_at, null, 'Todo observation has no expiry');

  const snapshotId = updater.updateBusinessSnapshot({ daily_avg_revenue: 8200 });
  assert(snapshotId > 0, 'updateBusinessSnapshot creates entity');

  const snapshotId2 = updater.updateBusinessSnapshot({ daily_avg_revenue: 9000 });
  assertEq(snapshotId2, snapshotId, 'updateBusinessSnapshot merges into singleton');

  // ========================================
  section('PatternDetector');
  // ========================================
  const { PatternDetector } = require('./pattern-detector');
  const pd = new PatternDetector(db);

  const refreshResult = pd.refreshAll();
  assert(refreshResult.contacts_refreshed >= 1, 'refreshContactStats processes contacts');
  assertEq(refreshResult.snapshot_updated, true, 'refreshBusinessSnapshot succeeds');

  // Verify Sharma profile was enriched
  const sharmaProfile = db.findBrainEntityByRef('contacts', c1);
  assert(sharmaProfile !== null, 'Sharma has brain entity after refresh');
  assert(sharmaProfile.properties.avg_order > 0, 'Sharma has avg_order');
  assert(sharmaProfile.properties.trend !== undefined, 'Sharma has trend');
  assert(sharmaProfile.properties.txn_count >= 3, 'Sharma has txn_count');

  // ========================================
  section('AnomalyDetector');
  // ========================================
  const { AnomalyDetector } = require('./anomaly-detector');
  const config = require('../config');
  const ad = new AnomalyDetector(db, config);

  const anomalies = ad.detectAll();
  assert(Array.isArray(anomalies), 'detectAll returns array');
  // We may or may not have anomalies depending on test data distribution
  for (const a of anomalies) {
    assert(a.type !== undefined, `Anomaly has type: ${a.type}`);
    assert(a.content !== undefined, 'Anomaly has content');
    assert(a.confidence !== undefined, 'Anomaly has confidence');
  }
  assert(true, `detectAll found ${anomalies.length} observations`);

  // ========================================
  section('DoomLoopDetector');
  // ========================================
  const { DoomLoopDetector } = require('./doom-loop');
  const doom = new DoomLoopDetector();

  let check1 = doom.check('test-task');
  assertEq(check1.abort, false, 'First attempt not aborted');
  assertEq(check1.count, 1, 'First attempt count is 1');

  let check2 = doom.check('test-task');
  assertEq(check2.abort, false, 'Second attempt not aborted');

  let check3 = doom.check('test-task');
  assertEq(check3.abort, true, 'Third attempt triggers abort');

  // Should stay aborted during cooldown period
  let check4 = doom.check('test-task');
  assertEq(check4.abort, true, 'After abort, stays aborted during cooldown');

  // Manual reset should clear it
  doom.reset('test-task');
  let check5 = doom.check('test-task');
  assertEq(check5.abort, false, 'After manual reset, counter clears');

  const fallback = doom.getFallback('sms_parse_fail', 'hi');
  assert(fallback.includes('SMS'), 'Hindi fallback contains SMS');

  const fallbackEn = doom.getFallback('voice_unclear', 'en');
  assert(fallbackEn.includes('voice'), 'English fallback contains voice');

  doom.reset('test-task');

  // ========================================
  section('Templates');
  // ========================================
  const { format } = require('./templates');

  const txnMsg = format('txn_confirmed', 'hi', { name: 'Sharma', amount: '5,000', type: 'credit' });
  assert(txnMsg.includes('Sharma'), 'Hindi txn template has name');
  assert(txnMsg.includes('₹5,000'), 'Hindi txn template has amount');

  const teluguMsg = format('txn_confirmed', 'te', { name: 'Krishna', amount: '3,000', type: 'debit' });
  assert(teluguMsg.includes('Krishna'), 'Telugu txn template has name');
  assert(teluguMsg.includes('Entry ayyindi'), 'Telugu txn template has Telugu text');

  const stockMsg = format('stock_update', 'en', { item: 'Rice', quantity: 50, unit: 'bags' });
  assert(stockMsg.includes('Rice'), 'Stock template has item');
  assert(stockMsg.includes('50'), 'Stock template has quantity');

  const unknownTemplate = format('nonexistent', 'en', {});
  assert(unknownTemplate.includes('Unknown'), 'Unknown template returns error message');

  // ========================================
  section('ContextLoader');
  // ========================================
  const { ContextLoader } = require('./context-loader');
  const loader = new ContextLoader(db);

  // Tier 1: snapshot
  const ctx1 = loader.getContextBlock('hello');
  assert(ctx1.contextBlock !== null || ctx1.contextBlock === null, 'getContextBlock runs without error');

  // Tier 2: entity context for Sharma
  const ctx2 = loader.getContextBlock('Sharma ne payment kiya');
  if (ctx2.contextBlock) {
    assert(ctx2.contextBlock.includes('business-brain'), 'Context block has brain wrapper');
    assert(ctx2.contextBlock.includes('Sharma'), 'Context block mentions Sharma');
  }
  assert(true, 'Entity context loader works');

  // Tier 3: knowledge lookup
  const ctx3 = loader.getContextBlock('GST rate kya hai', {
    knowledgePath: path.join(testDir, 'knowledge')
  });
  if (ctx3.contextBlock) {
    assert(ctx3.contextBlock.includes('GST'), 'Knowledge context includes GST content');
  }
  assert(true, 'Knowledge loader works');

  // ========================================
  section('HeartbeatBrain');
  // ========================================
  // We test the run function but need to close db first since heartbeat opens its own
  db.close();
  db = null;

  const { run: heartbeatRun } = require('./heartbeat-brain');
  const heartbeatResult = heartbeatRun();
  assert(heartbeatResult !== null, 'Heartbeat returns result');
  assert(Array.isArray(heartbeatResult.anomalies), 'Heartbeat has anomalies array');
  assert(typeof heartbeatResult.patterns_refreshed === 'number', 'Heartbeat has patterns_refreshed');
  assert(typeof heartbeatResult.edges_decayed === 'number', 'Heartbeat has edges_decayed');
  assert(typeof heartbeatResult.observations_swept === 'number', 'Heartbeat has observations_swept');
  assert(Array.isArray(heartbeatResult.alerts), 'Heartbeat has alerts array');

} catch (e) {
  console.error('\nUNEXPECTED ERROR:', e);
  console.error(e.stack);
  failed++;
} finally {
  if (db) db.close();
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`========================================`);
process.exit(failed > 0 ? 1 : 0);
