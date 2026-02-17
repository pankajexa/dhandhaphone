// Shared utilities for DhandhaPhone skills
const fs = require('fs');
const path = require('path');

const WORKSPACE = process.env.DHANDHA_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');

const PATHS = {
  workspace: WORKSPACE,
  ledger: (month) => path.join(WORKSPACE, 'ledger', `${month}.jsonl`),
  summary: path.join(WORKSPACE, 'ledger', 'summary.json'),
  contacts: path.join(WORKSPACE, 'contacts', 'contacts.json'),
  inventory: path.join(WORKSPACE, 'inventory', 'stock.json'),
  margins: path.join(WORKSPACE, 'inventory', 'margins.json'),
  priceHistory: path.join(WORKSPACE, 'inventory', 'price-history.jsonl'),
  pending: path.join(WORKSPACE, 'pending', 'actions.json'),
  reminders: path.join(WORKSPACE, 'pending', 'reminders.jsonl'),
  lastSmsId: path.join(WORKSPACE, 'sms', 'last_processed_id.txt'),
  lastNotificationId: path.join(WORKSPACE, 'sms', 'last_notification_id.txt'),
  categories: path.join(WORKSPACE, 'accounting', 'categories.json'),
  pnl: (month) => path.join(WORKSPACE, 'accounting', `pnl-${month}.json`),
  itc: (month) => path.join(WORKSPACE, 'accounting', `itc-${month}.json`),
  gstProfile: path.join(WORKSPACE, 'accounting', 'gst-profile.json'),
  txnBaseline: path.join(WORKSPACE, 'accounting', 'txn-baseline.json'),
  fraudAlerts: path.join(WORKSPACE, 'accounting', 'fraud-alerts.jsonl'),
  ocrDir: path.join(WORKSPACE, 'ocr'),
  documents: path.join(WORKSPACE, 'ocr', 'documents.jsonl'),
  anonMap: path.join(WORKSPACE, '.anon-map.json'),
};

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read ${filepath}: ${e.message}`);
    return null;
  }
}

function writeJSON(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function appendJSONL(filepath, obj) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.appendFileSync(filepath, JSON.stringify(obj) + '\n');
}

function readJSONL(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function generateTxnId() {
  const d = new Date();
  const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `txn_${dateStr}_${rand}`;
}

module.exports = {
  PATHS, readJSON, writeJSON, appendJSONL, readJSONL,
  currentMonth, todayISO, nowIST, generateTxnId
};
