#!/usr/bin/env node
// Polls SMS inbox, parses new financial messages, appends to ledger
// Designed to be called by OpenClaw cron job or heartbeat

const fs = require('fs');
const path = require('path');

// Resolve lib paths (works whether called directly or via symlink)
const libDir = path.join(__dirname, '..', '..', '..', 'lib');
const { readSMS, getNotifications } = require(path.join(libDir, 'termux-api'));
const { parseBankSMS, parseUPINotification } = require('./sms-parser');
const { PATHS, readJSON, writeJSON, appendJSONL, readJSONL,
        currentMonth, generateTxnId, nowIST } = require(path.join(libDir, 'utils'));

async function pollAndProcess() {
  const results = { new_transactions: [], errors: [] };

  // --- 1. Read last processed SMS ID ---
  let lastId = 0;
  try {
    lastId = parseInt(fs.readFileSync(PATHS.lastSmsId, 'utf8').trim()) || 0;
  } catch {}

  // --- 2. Fetch recent SMS ---
  let smsList = [];
  try {
    smsList = await readSMS(100); // Read last 100 SMS
  } catch (e) {
    results.errors.push(`SMS read failed: ${e.message}`);
    // Continue to notification fallback
  }

  // --- 3. Filter to new SMS only ---
  const newSMS = smsList.filter(s => s._id > lastId);

  // --- 4. Parse each SMS ---
  let maxId = lastId;
  for (const sms of newSMS) {
    if (sms._id > maxId) maxId = sms._id;

    const txn = parseBankSMS(sms);
    if (!txn) continue;

    txn.id = generateTxnId();

    // Dedup: check if same amount+ref already in today's ledger
    const todayTxns = readJSONL(PATHS.ledger(currentMonth()));
    const isDupe = todayTxns.some(t =>
      t.ref && t.ref === txn.ref && t.amount === txn.amount
    );
    if (isDupe) continue;

    // Append to ledger
    appendJSONL(PATHS.ledger(currentMonth()), txn);
    results.new_transactions.push(txn);
  }

  // --- 5. Also check UPI app notifications ---
  try {
    const notifs = await getNotifications();
    for (const notif of notifs) {
      const parsed = parseUPINotification(notif);
      if (!parsed) continue;

      // Dedup against recently added transactions (same amount within 2 min)
      const isDupe = results.new_transactions.some(t =>
        t.amount === parsed.amount && t.type === parsed.type
      );
      if (isDupe) continue;

      // Also check existing ledger for today
      const todayTxns = readJSONL(PATHS.ledger(currentMonth()));
      const recentDupe = todayTxns.some(t => {
        if (t.amount !== parsed.amount || t.type !== parsed.type) return false;
        const tTime = new Date(t.ts).getTime();
        const now = Date.now();
        return (now - tTime) < 5 * 60 * 1000; // within 5 minutes
      });
      if (recentDupe) continue;

      const txn = {
        id: generateTxnId(),
        ts: new Date().toISOString(),
        type: parsed.type,
        amount: parsed.amount,
        counterparty: parsed.counterparty,
        method: parsed.method,
        ref: null,
        bank: null,
        acct_last4: null,
        raw: `[${parsed.source}] ${notif.title}: ${notif.content}`,
        source: parsed.source,
        sms_id: null,
        category: null,
        notes: null
      };

      appendJSONL(PATHS.ledger(currentMonth()), txn);
      results.new_transactions.push(txn);
    }
  } catch (e) {
    results.errors.push(`Notification read failed: ${e.message}`);
  }

  // --- 6. Update last processed ID ---
  if (maxId > lastId) {
    fs.writeFileSync(PATHS.lastSmsId, String(maxId));
  }

  // --- 7. Update summary ---
  updateSummary();

  return results;
}

function updateSummary() {
  const month = currentMonth();
  const allTxns = readJSONL(PATHS.ledger(month));
  const today = new Date().toISOString().split('T')[0];

  // Calculate today
  const todayTxns = allTxns.filter(t => t.ts && t.ts.startsWith(today));
  const todayCredits = todayTxns.filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0);
  const todayDebits = todayTxns.filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  // Calculate this week (Monday start)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString().split('T')[0];

  const weekTxns = allTxns.filter(t => t.ts && t.ts >= weekStartISO);
  const weekCredits = weekTxns.filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0);
  const weekDebits = weekTxns.filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  // Calculate this month
  const monthCredits = allTxns.filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0);
  const monthDebits = allTxns.filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  const summary = {
    today: { credits: todayCredits, debits: todayDebits, count: todayTxns.length, date: today },
    this_week: { credits: weekCredits, debits: weekDebits, count: weekTxns.length, week_start: weekStartISO },
    this_month: { credits: monthCredits, debits: monthDebits, count: allTxns.length, month },
    last_updated: new Date().toISOString()
  };

  writeJSON(PATHS.summary, summary);
  return summary;
}

// If run directly (by cron/heartbeat)
if (require.main === module) {
  pollAndProcess()
    .then(r => {
      if (r.new_transactions.length > 0) {
        console.log(`Processed ${r.new_transactions.length} new transactions.`);
        for (const t of r.new_transactions) {
          console.log(`  ${t.type === 'credit' ? '+' : '-'}₹${t.amount} ${t.counterparty || ''} (${t.method})`);
        }
      }
      if (r.errors.length > 0) {
        console.error('Errors:', r.errors);
      }
    })
    .catch(e => console.error('Poll failed:', e));
}

module.exports = { pollAndProcess, updateSummary };
