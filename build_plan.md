# DhandhaPhone — Build Plan

> **Prerequisites:** Read `context.md` first. It contains all architecture details, schemas, SMS patterns, and platform constraints referenced below.

---

## Build Overview

```
Phase 1: Bootstrap & Foundation     [Tasks 1.1–1.5]  ~2 days
Phase 2: SMS Transaction Engine     [Tasks 2.1–2.5]  ~3 days
Phase 3: Business Memory Skills     [Tasks 3.1–3.4]  ~2 days
Phase 4: Proactive Briefings        [Tasks 4.1–4.4]  ~2 days
Phase 5: Document Intelligence      [Tasks 5.1–5.3]  ~2 days
Phase 6: Anonymization Layer        [Tasks 6.1–6.3]  ~1 day
Phase 7: Agent Personality & Config [Tasks 7.1–7.4]  ~1 day
Phase 8: Cloud LLM Router (Backend) [Tasks 8.1–8.4]  ~2 days
Phase 9: Integration & Hardening    [Tasks 9.1–9.4]  ~2 days
Phase 10: Setup Automation Script   [Tasks 10.1–10.3] ~1 day
```

**Total: ~18 working days for a solo developer**

All code targets Node.js 22 running inside proot Ubuntu on Android.
All skills are Markdown files with optional helper scripts in Node.js or Bash.
The cloud backend (Phase 8) is a separate Python/FastAPI service running on your existing server infrastructure.

---

## Phase 1: Bootstrap & Foundation

### Task 1.1: Create Project Directory Structure

Create the entire workspace scaffold that OpenClaw expects, plus our custom directories.

**Action:** Create the following directory tree under `~/.openclaw/workspace/`:

```bash
mkdir -p ~/.openclaw/workspace/{skills/{sms-ledger/scripts,business-memory/scripts,business-briefing/scripts,document-intel/scripts},ledger,contacts,inventory,pending,sms,ocr}
```

**Then create empty data files with initial schemas:**

**File: `~/.openclaw/workspace/ledger/summary.json`**
```json
{
  "today": {"credits": 0, "debits": 0, "count": 0, "date": ""},
  "this_week": {"credits": 0, "debits": 0, "count": 0, "week_start": ""},
  "this_month": {"credits": 0, "debits": 0, "count": 0, "month": ""},
  "last_updated": ""
}
```

**File: `~/.openclaw/workspace/contacts/contacts.json`**
```json
{
  "contacts": [],
  "next_customer_id": 1,
  "next_supplier_id": 1,
  "next_staff_id": 1
}
```

**File: `~/.openclaw/workspace/inventory/stock.json`**
```json
{
  "items": [],
  "last_updated": ""
}
```

**File: `~/.openclaw/workspace/pending/actions.json`**
```json
{
  "actions": [],
  "next_id": 1
}
```

**File: `~/.openclaw/workspace/sms/last_processed_id.txt`**
```
0
```

**File: `~/.openclaw/workspace/.anon-map.json`**
```json
{
  "people": {},
  "phones": {},
  "accounts": {},
  "reverse_people": {}
}
```

**Acceptance:** All directories exist, all JSON files parse without errors.

---

### Task 1.2: Create Termux:API Bridge Script

The OpenClaw Gateway runs inside proot Ubuntu. Termux:API commands live outside proot. We need a bridge.

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/termux-bridge.sh`**
```bash
#!/bin/bash
# Bridge script to call Termux:API from inside proot Ubuntu
# Usage: ./termux-bridge.sh <command> [args...]
# Example: ./termux-bridge.sh termux-sms-list -l 50 -t inbox

TERMUX_BIN="/host-rootfs/data/data/com.termux/files/usr/bin"

if [ ! -d "$TERMUX_BIN" ]; then
  # Fallback: try direct path (some proot setups mount differently)
  TERMUX_BIN="/data/data/com.termux/files/usr/bin"
fi

CMD="$1"
shift

if [ -x "$TERMUX_BIN/$CMD" ]; then
  exec "$TERMUX_BIN/$CMD" "$@"
else
  echo "{\"error\": \"Command $CMD not found at $TERMUX_BIN\"}" >&2
  exit 1
fi
```

```bash
chmod +x ~/.openclaw/workspace/skills/sms-ledger/scripts/termux-bridge.sh
```

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/termux-api.js`**
```javascript
// Node.js wrapper for Termux:API commands
// Usage: const api = require('./termux-api'); const sms = await api.readSMS(50);

const { execFile } = require('child_process');
const path = require('path');

const BRIDGE = path.join(__dirname, 'termux-bridge.sh');

function exec(cmd, args = []) {
  return new Promise((resolve, reject) => {
    // Try direct proot path first, fallback to bridge
    const paths = [
      '/host-rootfs/data/data/com.termux/files/usr/bin/' + cmd,
      '/data/data/com.termux/files/usr/bin/' + cmd,
    ];
    
    // Use bridge script approach
    execFile('bash', [BRIDGE, cmd, ...args], {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5, // 5MB for large SMS lists
      env: { ...process.env, LD_LIBRARY_PATH: '' }
    }, (err, stdout, stderr) => {
      if (err) {
        // Fallback: try calling command directly (some setups)
        execFile(cmd, args, { timeout: 30000 }, (err2, stdout2) => {
          if (err2) reject(new Error(`termux-api ${cmd} failed: ${err.message}`));
          else resolve(stdout2.trim());
        });
        return;
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = {
  async readSMS(limit = 50) {
    const raw = await exec('termux-sms-list', ['-l', String(limit), '-t', 'inbox']);
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async sendSMS(number, text) {
    return exec('termux-sms-send', ['-n', number, text]);
  },

  async getNotifications() {
    const raw = await exec('termux-notification-list');
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async getCallLog(limit = 10) {
    const raw = await exec('termux-call-log', ['-l', String(limit)]);
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async getBatteryStatus() {
    const raw = await exec('termux-battery-status');
    try { return JSON.parse(raw); }
    catch { return { percentage: -1 }; }
  },

  async vibrate(duration = 500) {
    return exec('termux-vibrate', ['-d', String(duration)]);
  }
};
```

**Acceptance:** From inside proot Ubuntu, running `node -e "require('./termux-api').readSMS(5).then(r => console.log(JSON.stringify(r,null,2)))"` returns real SMS data from the phone.

---

### Task 1.3: Create Shared Utility Module

Common utilities used across all skills.

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/utils.js`**
```javascript
// Shared utilities for DhandhaPhone skills
const fs = require('fs');
const path = require('path');

const WORKSPACE = process.env.HOME + '/.openclaw/workspace';

const PATHS = {
  workspace: WORKSPACE,
  ledger: (month) => path.join(WORKSPACE, 'ledger', `${month}.jsonl`),
  summary: path.join(WORKSPACE, 'ledger', 'summary.json'),
  contacts: path.join(WORKSPACE, 'contacts', 'contacts.json'),
  inventory: path.join(WORKSPACE, 'inventory', 'stock.json'),
  pending: path.join(WORKSPACE, 'pending', 'actions.json'),
  lastSmsId: path.join(WORKSPACE, 'sms', 'last_processed_id.txt'),
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
```

**Acceptance:** `node -e "const u = require('./utils'); console.log(u.currentMonth(), u.todayISO())"` outputs current month and date.

---

### Task 1.4: Symlink Shared Scripts Across Skills

All skills need access to `termux-api.js` and `utils.js`. Symlink them.

```bash
# From workspace root
cd ~/.openclaw/workspace/skills

# Copy shared scripts to a common location
mkdir -p ../lib
cp sms-ledger/scripts/termux-api.js ../lib/
cp sms-ledger/scripts/termux-bridge.sh ../lib/
cp sms-ledger/scripts/utils.js ../lib/
chmod +x ../lib/termux-bridge.sh

# Symlink into each skill's scripts directory
for skill in business-memory business-briefing document-intel; do
  ln -sf ../../lib/termux-api.js $skill/scripts/termux-api.js
  ln -sf ../../lib/termux-bridge.sh $skill/scripts/termux-bridge.sh
  ln -sf ../../lib/utils.js $skill/scripts/utils.js
done

# Update sms-ledger to use the lib copies too
ln -sf ../../lib/termux-api.js sms-ledger/scripts/termux-api.js
ln -sf ../../lib/termux-bridge.sh sms-ledger/scripts/termux-bridge.sh
ln -sf ../../lib/utils.js sms-ledger/scripts/utils.js
```

**Acceptance:** `ls -la ~/.openclaw/workspace/skills/business-memory/scripts/` shows symlinks to `../../lib/`.

---

### Task 1.5: Verify OpenClaw Gateway Health

Before building skills, confirm the foundation is solid.

```bash
# Inside proot Ubuntu
export NODE_OPTIONS="--require ~/.openclaw/bionic-bypass.js"
openclaw --version
openclaw config get gateway.auth.token
openclaw gateway --verbose &
sleep 5
curl -s http://127.0.0.1:18789/api/health | head -20
```

**Acceptance:** Gateway responds to health check. Telegram bot responds to a test message.

---

## Phase 2: SMS Transaction Engine

This is the highest-value skill. It passively reads bank SMS and logs every transaction.

### Task 2.1: Build SMS Parser Module

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/sms-parser.js`**

```javascript
// Parses Indian bank SMS into structured transactions
// Handles: SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, and generic patterns

/**
 * Parse a bank SMS into a transaction object.
 * Returns null if SMS is not a financial transaction.
 */
function parseBankSMS(sms) {
  const body = sms.body || '';
  const sender = (sms.address || '').toUpperCase();
  
  // Skip OTP, promotional, non-financial SMS
  if (/OTP|otp|One Time Password|verification code/i.test(body)) return null;
  if (/offer|cashback|reward|EMI|loan|insurance|credit card/i.test(body) 
      && !/credited|debited/i.test(body)) return null;
  
  let txn = {
    id: null, // set by caller
    ts: parseTimestamp(sms.date),
    type: null,     // 'credit' or 'debit'
    amount: null,
    counterparty: null,
    method: null,    // 'UPI', 'NEFT', 'IMPS', 'ATM', 'POS', 'CASH', 'OTHER'
    ref: null,
    bank: identifyBank(sender),
    acct_last4: null,
    raw: body,
    source: 'sms',
    sms_id: sms._id,
    category: null,
    notes: null
  };

  // --- AMOUNT EXTRACTION ---
  // Patterns: "Rs.5000.00", "Rs 5,000.00", "INR 5000.00", "₹5,000", "Rs.5,000/-"
  const amountPatterns = [
    /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:amount|amt)\s*(?:of\s*)?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{2}))\s*(?:has been|is)\s*(?:credited|debited)/i,
  ];
  
  for (const pat of amountPatterns) {
    const m = body.match(pat);
    if (m) {
      txn.amount = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }
  if (!txn.amount || txn.amount <= 0) return null;

  // --- CREDIT / DEBIT DETECTION ---
  if (/credited|received|credit(?:ed)?|deposited/i.test(body)) {
    txn.type = 'credit';
  } else if (/debited|sent|debit(?:ed)?|withdrawn|paid|purchase/i.test(body)) {
    txn.type = 'debit';
  } else {
    return null; // Can't determine direction
  }

  // --- ACCOUNT NUMBER ---
  const acctMatch = body.match(/(?:a\/c|acct?|account)\s*(?:no\.?\s*)?[X*x]*(\d{4})/i);
  if (acctMatch) txn.acct_last4 = acctMatch[1];

  // --- UPI REFERENCE ---
  const upiMatch = body.match(/(?:UPI)\s*(?:ref\.?|Ref\.?\s*(?:No\.?)?\s*:?\s*|txn\s*)(\d{6,12})/i);
  if (upiMatch) {
    txn.ref = upiMatch[1];
    txn.method = 'UPI';
  }
  
  // --- NEFT / IMPS / RTGS ---
  if (/NEFT/i.test(body)) txn.method = 'NEFT';
  else if (/IMPS/i.test(body)) txn.method = 'IMPS';
  else if (/RTGS/i.test(body)) txn.method = 'RTGS';
  else if (/ATM/i.test(body)) txn.method = 'ATM';
  else if (/POS|purchase|merchant/i.test(body)) txn.method = 'POS';
  if (!txn.method) txn.method = 'OTHER';

  // --- COUNTERPARTY ---
  const cpPatterns = [
    /(?:from|to|trf\s+(?:from|to)|transfer\s+(?:from|to))\s+([A-Z][A-Z\s]{2,30}?)(?:\s*\(|\s*\.|\s*-|\s*UPI|\s*Ref|\s*Avl|$)/i,
    /(?:by|via)\s+([A-Z][A-Z\s]{2,30}?)(?:\s*\(|\s*\.|\s*-|\s*UPI|\s*Ref|$)/i,
    /VPA\s+(\S+@\S+)/i, // UPI VPA
  ];
  
  for (const pat of cpPatterns) {
    const m = body.match(pat);
    if (m) {
      txn.counterparty = m[1].trim()
        .replace(/\s+/g, ' ')       // normalize spaces
        .replace(/[()]/g, '')        // remove parens
        .substring(0, 50);           // cap length
      break;
    }
  }

  return txn;
}

function parseTimestamp(dateStr) {
  if (!dateStr) return new Date().toISOString();
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}
  return new Date().toISOString();
}

function identifyBank(sender) {
  const s = sender.toUpperCase();
  if (/HDFC|HDFCBK/i.test(s)) return 'HDFC';
  if (/SBI|SBIINB|SBISMS/i.test(s)) return 'SBI';
  if (/ICICI|ICICIB/i.test(s)) return 'ICICI';
  if (/AXIS|AXISBK/i.test(s)) return 'AXIS';
  if (/KOTAK|KOTAKB/i.test(s)) return 'KOTAK';
  if (/PNB|PNBSMS/i.test(s)) return 'PNB';
  if (/BOB|BOBIBN/i.test(s)) return 'BOB';
  if (/CANARA|CANBK/i.test(s)) return 'CANARA';
  if (/UNION|UNBISMS/i.test(s)) return 'UNION';
  if (/INDUS|IBKL/i.test(s)) return 'INDUSIND';
  if (/FEDER|FEDBK/i.test(s)) return 'FEDERAL';
  return 'UNKNOWN';
}

/**
 * Parse UPI app notifications (from termux-notification-list)
 */
function parseUPINotification(notif) {
  const pkg = notif.packageName || '';
  const title = notif.title || '';
  const content = notif.content || '';
  const combined = `${title} ${content}`;
  
  // Google Pay
  if (pkg.includes('nbu.paisa') || pkg.includes('tez')) {
    return parseGenericPaymentNotif(combined, 'GPAY');
  }
  // PhonePe
  if (pkg.includes('phonepe')) {
    return parseGenericPaymentNotif(combined, 'PHONEPE');
  }
  // Paytm
  if (pkg.includes('paytm') || pkg.includes('one97')) {
    return parseGenericPaymentNotif(combined, 'PAYTM');
  }
  
  return null;
}

function parseGenericPaymentNotif(text, app) {
  const amountMatch = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;
  
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (amount <= 0) return null;
  
  const isCredit = /received|credited|got|incoming/i.test(text);
  const isDebit = /sent|paid|debited|outgoing/i.test(text);
  if (!isCredit && !isDebit) return null;
  
  // Extract name
  let counterparty = null;
  const nameMatch = text.match(/(?:from|to)\s+([A-Za-z][A-Za-z\s]{2,30})/i);
  if (nameMatch) counterparty = nameMatch[1].trim();
  
  return {
    type: isCredit ? 'credit' : 'debit',
    amount,
    counterparty,
    method: 'UPI',
    source: `notification-${app.toLowerCase()}`,
  };
}

module.exports = { parseBankSMS, parseUPINotification };
```

**Acceptance:** Create test file with 10+ real Indian bank SMS samples. All parse correctly with type, amount, bank, and counterparty extracted.

---

### Task 2.2: Build SMS Polling and Dedup Engine

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/sms-poller.js`**

```javascript
#!/usr/bin/env node
// Polls SMS inbox, parses new financial messages, appends to ledger
// Designed to be called by OpenClaw cron job or heartbeat

const fs = require('fs');
const { readSMS, getNotifications } = require('./termux-api');
const { parseBankSMS, parseUPINotification } = require('./sms-parser');
const { PATHS, readJSON, writeJSON, appendJSONL, readJSONL,
        currentMonth, generateTxnId, nowIST } = require('./utils');

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
          console.log(`  ${t.type === 'credit' ? '💰 +' : '💸 -'}₹${t.amount} ${t.counterparty || ''} (${t.method})`);
        }
      }
      if (r.errors.length > 0) {
        console.error('Errors:', r.errors);
      }
    })
    .catch(e => console.error('Poll failed:', e));
}

module.exports = { pollAndProcess, updateSummary };
```

**Acceptance:** Insert a test bank SMS via `termux-sms-send` to yourself, then run `node sms-poller.js`. Transaction appears in the JSONL ledger file.

---

### Task 2.3: Create SMS Ledger SKILL.md

**File: `~/.openclaw/workspace/skills/sms-ledger/SKILL.md`**

```markdown
---
name: sms-ledger
description: >
  Parses bank and UPI SMS messages into structured transactions.
  Automatically polls for new SMS. Maintains a local JSONL transaction
  ledger and running summary. Use when user asks about payments,
  revenue, expenses, balances, sales, income, or any financial query.
  Also triggers when reporting new transactions or payment events.
metadata:
  openclaw:
    emoji: "💰"
---

# SMS Transaction Ledger

## What This Skill Does
Automatically reads bank SMS and UPI app notifications from the AI
phone's SIM card, extracts financial transactions, and maintains a
local ledger. This is the primary source of truth for all money data.

## Transaction Ledger Location
- Monthly files: `workspace/ledger/YYYY-MM.jsonl` (one JSON per line)
- Running summary: `workspace/ledger/summary.json`

## How to Poll for New SMS
Run the poller script to check for new transactions:
```bash
node workspace/skills/sms-ledger/scripts/sms-poller.js
```
This is normally called by the sms-poll cron job every 5 minutes.
You can also run it manually if the user asks "check for new payments."

## How to Read Ledger Data
- Read summary for quick stats: `cat workspace/ledger/summary.json`
- Read current month transactions: `cat workspace/ledger/YYYY-MM.jsonl`
- Search for specific transactions: `grep "SHARMA" workspace/ledger/2026-02.jsonl`

## Transaction Schema
Each line in the JSONL file:
```json
{
  "id": "txn_20260217_0001",
  "ts": "2026-02-17T10:30:00+05:30",
  "type": "credit",
  "amount": 5000,
  "counterparty": "SHARMA",
  "method": "UPI",
  "ref": "423567890",
  "bank": "HDFC",
  "acct_last4": "1234",
  "raw": "original SMS text...",
  "source": "sms",
  "category": null,
  "notes": null
}
```

## Summary Schema
```json
{
  "today": {"credits": 32400, "debits": 8200, "count": 15, "date": "2026-02-17"},
  "this_week": {"credits": 147200, "debits": 53000, "count": 72},
  "this_month": {"credits": 523000, "debits": 187000, "count": 312}
}
```

## Answering Financial Questions

When user asks about money:
1. Read `workspace/ledger/summary.json` for quick answers
2. For detailed queries, grep the JSONL file
3. Always respond with actual numbers from the ledger, not estimates
4. Format amounts in Indian style: ₹5,000 not $5000

Examples:
- "Aaj kitna aaya?" → Read summary.today.credits
- "Week ka total?" → Read summary.this_week
- "Sharma ne pay kiya?" → grep SHARMA in recent ledger entries
- "Kal ke transactions dikha" → filter by yesterday's date

## Manual Transaction Entry
If user reports a cash transaction that won't appear in SMS:
- "Cash mein 2000 mila Mehta se"
→ Create a transaction entry with source: "manual" and method: "CASH"
→ Append to the JSONL ledger file directly:
```bash
echo '{"id":"txn_YYYYMMDD_XXXX","ts":"...","type":"credit","amount":2000,"counterparty":"MEHTA","method":"CASH","ref":null,"bank":null,"acct_last4":null,"raw":"manual entry","source":"manual","category":null,"notes":"Reported by owner via chat"}' >> workspace/ledger/YYYY-MM.jsonl
```
Then run the summary updater.

## Important Notes
- SBI may not send credit SMS for all UPI transactions (only @sbi/@oksbi)
- HDFC skips SMS for small UPI transactions (<₹100 debit, <₹500 credit)
- The notification listener catches payments the SMS misses
- Never modify old ledger entries — append corrections as new entries
- Always update summary.json after adding transactions
```

**Acceptance:** Message the Telegram bot with "aaj kitna aaya?" and get an answer based on actual ledger data.

---

### Task 2.4: Create SMS Parser Test Suite

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/test-parser.js`**

```javascript
#!/usr/bin/env node
// Test SMS parser against real Indian bank message formats

const { parseBankSMS } = require('./sms-parser');

const testCases = [
  // HDFC Credit
  {
    sms: { _id: 1, address: "HDFCBK", body: "Rs.5000.00 credited to a/c XX1234 on 17-02-26 by UPI ref 423567890. Avl bal: Rs.47200.00", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "HDFC", method: "UPI", acct_last4: "1234" }
  },
  // HDFC Debit
  {
    sms: { _id: 2, address: "HDFCBK", body: "Rs.12000.00 debited from a/c XX1234 on 17-02-26. UPI txn Ref 987654321. Avl bal: Rs.35200.00", date: "2026-02-17 14:00:00" },
    expect: { type: "debit", amount: 12000, bank: "HDFC", method: "UPI" }
  },
  // SBI Credit
  {
    sms: { _id: 3, address: "SBIINB", body: "Dear Customer, your a/c no. XX5678 is credited by Rs.5,000.00 on 17Feb26 transfer from SHARMA (UPI Ref No 423567890). -SBI", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "SBI", counterparty: "SHARMA" }
  },
  // ICICI Credit
  {
    sms: { _id: 4, address: "ICICIB", body: "ICICI Bank Acct XX9012 credited with Rs 5,000.00 on 17-Feb-26; UPI: 423567890 from SHARMA. Avl Bal Rs 47,200.00", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "ICICI", counterparty: "SHARMA" }
  },
  // Axis Debit
  {
    sms: { _id: 5, address: "AxisBk", body: "Rs 8,500.00 debited from A/c no. XX3456 on 17-02-2026 through UPI-555555555. Bal: Rs 25,000.00", date: "2026-02-17 16:00:00" },
    expect: { type: "debit", amount: 8500, bank: "AXIS", method: "UPI" }
  },
  // NEFT transfer
  {
    sms: { _id: 6, address: "HDFCBK", body: "INR 25,000.00 credited to HDFC Bank A/c XX1234 on 17-02-2026 by a NEFT transfer from GUPTA SUPPLIERS. Avl bal: INR 72,200.00", date: "2026-02-17 11:00:00" },
    expect: { type: "credit", amount: 25000, bank: "HDFC", method: "NEFT", counterparty: "GUPTA SUPPLIERS" }
  },
  // OTP — should return null
  {
    sms: { _id: 7, address: "HDFCBK", body: "Your OTP for transaction is 456789. Valid for 3 minutes. Do not share. -HDFC Bank", date: "2026-02-17 10:35:00" },
    expect: null
  },
  // Promotional — should return null
  {
    sms: { _id: 8, address: "HDFCBK", body: "Get 10% cashback on credit card spends above Rs.5000. Offer valid till 28 Feb. T&C apply.", date: "2026-02-17 09:00:00" },
    expect: null
  },
  // Kotak Credit
  {
    sms: { _id: 9, address: "KOTAKB", body: "Rs 3500.00 is credited in your Kotak Bank A/c XX7890 on 17/02/2026 by NEFT from PATEL HARDWARE. Updated Bal:Rs 28500.00", date: "2026-02-17 15:00:00" },
    expect: { type: "credit", amount: 3500, bank: "KOTAK", method: "NEFT" }
  },
  // Rupee symbol format
  {
    sms: { _id: 10, address: "SBIINB", body: "₹15,000 received in XX5678 from MEHTA via UPI Ref 111222333", date: "2026-02-17 12:00:00" },
    expect: { type: "credit", amount: 15000, bank: "SBI", method: "UPI" }
  },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = parseBankSMS(tc.sms);
  
  if (tc.expect === null) {
    if (result === null) {
      passed++;
      console.log(`✅ SMS #${tc.sms._id}: Correctly ignored`);
    } else {
      failed++;
      console.log(`❌ SMS #${tc.sms._id}: Should be null but got:`, result);
    }
    continue;
  }
  
  if (result === null) {
    failed++;
    console.log(`❌ SMS #${tc.sms._id}: Returned null, expected:`, tc.expect);
    continue;
  }
  
  let ok = true;
  for (const [key, val] of Object.entries(tc.expect)) {
    if (result[key] !== val) {
      ok = false;
      console.log(`❌ SMS #${tc.sms._id}: ${key} = "${result[key]}", expected "${val}"`);
    }
  }
  if (ok) {
    passed++;
    console.log(`✅ SMS #${tc.sms._id}: ${result.type} ₹${result.amount} ${result.bank} ${result.counterparty || ''}`);
  } else {
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} tests passed.`);
process.exit(failed > 0 ? 1 : 0);
```

**Acceptance:** `node test-parser.js` → all tests pass (10/10).

---

### Task 2.5: Register SMS Poll Cron Job

After skill is built and tested, register the cron job that runs it automatically.

```bash
openclaw cron add --json '{
  "name": "sms-poll",
  "schedule": {"kind": "cron", "expr": "*/5 * * * *", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run the SMS poller to check for new bank transactions. Execute: node workspace/skills/sms-ledger/scripts/sms-poller.js. If any large transactions (>₹5000) were found, send a brief alert to the owner via Telegram with the amount and counterparty. If no new transactions, do nothing.",
    "deliver": false
  }
}'
```

**Acceptance:** Wait 5 minutes. Send yourself a test SMS formatted like a bank alert. Verify it appears in the ledger within 10 minutes.

---

## Phase 3: Business Memory Skills

### Task 3.1: Create Business Memory SKILL.md

**File: `~/.openclaw/workspace/skills/business-memory/SKILL.md`**

Write this skill following the exact format shown in `context.md` Section 3. The skill must:

1. Define contact, inventory, and pending action schemas (reference `context.md` Section 8)
2. Instruct the LLM to silently extract business data from EVERY conversation
3. Update contacts.json, stock.json, actions.json after each interaction
4. Never ask the user to "enter data" — extract from natural conversation
5. Handle Hindi-English mixed input
6. Provide lookup capabilities ("Who owes me?", "Stock kitna hai?", "Gupta ka last order?")
7. Include 10+ example user inputs and expected agent behavior

**Key instruction to include:**
```markdown
## CRITICAL: Silent Data Extraction

When the owner says ANYTHING about their business, extract data WITHOUT
being asked. They will never say "add Gupta to contacts." They'll say
"Gupta ka delivery aaya, 50 bags, 19000 ka invoice." YOU must:

1. Check if "Gupta" exists in contacts.json
   - If yes: update last_interaction, adjust balance (+19000 payable)
   - If no: create new supplier entry
2. Update inventory (stock +50 bags)
3. Log the payable in pending/actions.json

Then confirm BRIEFLY: "Got it — Gupta se 50 bags mila, ₹19,000
payable. Cement stock now 62 bags."

Do NOT give a long-winded response. Business owners want confirmation,
not conversation.
```

**Acceptance:** Chat with the bot: "Sharma ne 50 bags cement order diya, delivery kal hoga, total 19000." Verify: Sharma appears in contacts.json, pending delivery appears in actions.json.

---

### Task 3.2: Create Contact Lookup Helper

**File: `~/.openclaw/workspace/skills/business-memory/scripts/contact-lookup.js`**

```javascript
#!/usr/bin/env node
// Quick contact lookup tool for the business memory skill
// Usage: node contact-lookup.js "sharma"
// Returns matching contacts as JSON

const { PATHS, readJSON } = require('./utils');

const query = process.argv[2];
if (!query) {
  console.log('Usage: node contact-lookup.js <name>');
  process.exit(1);
}

const data = readJSON(PATHS.contacts);
if (!data || !data.contacts) {
  console.log('[]');
  process.exit(0);
}

const matches = data.contacts.filter(c =>
  c.name.toLowerCase().includes(query.toLowerCase())
);

console.log(JSON.stringify(matches, null, 2));
```

**Acceptance:** After adding Sharma via conversation, `node contact-lookup.js sharma` returns the contact.

---

### Task 3.3: Create Ledger Query Helper

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/ledger-query.js`**

```javascript
#!/usr/bin/env node
// Query ledger for specific transactions
// Usage: node ledger-query.js [--today|--week|--month] [--type credit|debit] [--name SHARMA] [--min 1000]

const { PATHS, readJSONL, currentMonth, todayISO } = require('./utils');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    flags[args[i].slice(2)] = args[i + 1] || true;
    if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
  }
}

const txns = readJSONL(PATHS.ledger(currentMonth()));
let filtered = txns;

// Date filters
const today = todayISO();
if (flags.today) {
  filtered = filtered.filter(t => t.ts && t.ts.startsWith(today));
}
if (flags.yesterday) {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const yday = d.toISOString().split('T')[0];
  filtered = filtered.filter(t => t.ts && t.ts.startsWith(yday));
}
if (flags.week) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  const ws = weekStart.toISOString().split('T')[0];
  filtered = filtered.filter(t => t.ts && t.ts >= ws);
}

// Type filter
if (flags.type) {
  filtered = filtered.filter(t => t.type === flags.type);
}

// Name filter
if (flags.name) {
  const name = flags.name.toUpperCase();
  filtered = filtered.filter(t =>
    t.counterparty && t.counterparty.toUpperCase().includes(name)
  );
}

// Amount filter
if (flags.min) {
  filtered = filtered.filter(t => t.amount >= parseFloat(flags.min));
}

// Output
const total = filtered.reduce((s, t) => s + t.amount, 0);
console.log(JSON.stringify({
  count: filtered.length,
  total,
  transactions: filtered
}, null, 2));
```

**Acceptance:** `node ledger-query.js --today --type credit` returns today's credits with correct total.

---

### Task 3.4: Create Summary Regeneration Script

**File: `~/.openclaw/workspace/skills/sms-ledger/scripts/rebuild-summary.js`**

This script rebuilds `summary.json` from the JSONL ledger files. Used as a recovery tool if summary gets corrupted.

```javascript
#!/usr/bin/env node
const { updateSummary } = require('./sms-poller');
const summary = updateSummary();
console.log('Summary rebuilt:');
console.log(JSON.stringify(summary, null, 2));
```

**Acceptance:** Delete summary.json, run this script, verify it's recreated correctly from ledger data.

---

## Phase 4: Proactive Briefings

### Task 4.1: Create Business Briefing SKILL.md

**File: `~/.openclaw/workspace/skills/business-briefing/SKILL.md`**

Must include:
- Morning briefing template (7 AM) — yesterday's numbers, pending receivables, stock alerts, pending actions
- EOD summary template (9 PM) — today's numbers, biggest transactions, tomorrow's expected events
- Weekly report template (Sunday 8 PM) — week comparison, top customers, trends
- **Language: Hindi-English mix (Hinglish) by default**
- Format: casual, brief, emoji-enhanced, under 200 words
- Must reference actual file paths for data reading
- Include the exact morning/EOD example formats from `context.md` Section 7

**Key section:**
```markdown
## Morning Briefing Format

Read these files and compose a brief, actionable summary:
1. `workspace/ledger/summary.json` — yesterday's numbers
2. `workspace/contacts/contacts.json` — pending receivables (balance > 0)
3. `workspace/inventory/stock.json` — low stock (quantity < reorder_point)
4. `workspace/pending/actions.json` — pending actions

Template (adapt, don't copy literally):
"Suprabhat! 🌅
Kal ka hisaab: ₹{yesterday_credits} aaya ({count} orders), ₹{debits} gaya.
⚠️ {overdue customer + amount + days} — yaad dilayein?
📦 {low stock item} sirf {qty} bacha — order dena chahiye.
{any expected events today}
Aaj ka din achha ho! 💪"

IMPORTANT: Keep under 200 words. Use ₹ symbol, not Rs.
Use emojis sparingly but effectively.
Be a smart manager, not a report generator.
```

**Acceptance:** Manually trigger the morning briefing cron job. Telegram message arrives with actual numbers from ledger.

---

### Task 4.2: Register Morning Briefing Cron

```bash
openclaw cron add --json '{
  "name": "morning-briefing",
  "schedule": {"kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Generate morning business briefing. Read workspace/ledger/summary.json for yesterday numbers. Read workspace/contacts/contacts.json for pending receivables (contacts where balance > 0). Read workspace/inventory/stock.json for low stock items. Read workspace/pending/actions.json for pending tasks. Compose and send a concise Hinglish morning briefing via Telegram. Keep under 200 words.",
    "deliver": true,
    "channel": "telegram",
    "bestEffortDeliver": true
  }
}'
```

### Task 4.3: Register EOD Summary Cron

```bash
openclaw cron add --json '{
  "name": "eod-summary",
  "schedule": {"kind": "cron", "expr": "0 21 * * *", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Generate end-of-day business summary. Read workspace/ledger/summary.json for today stats. Read this month workspace/ledger/YYYY-MM.jsonl and filter for today to find biggest transactions. Summarize in Hinglish, keep brief. Send via Telegram.",
    "deliver": true,
    "channel": "telegram",
    "bestEffortDeliver": true
  }
}'
```

### Task 4.4: Register Weekly Report Cron

```bash
openclaw cron add --json '{
  "name": "weekly-report",
  "schedule": {"kind": "cron", "expr": "0 20 * * 0", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Generate weekly business report. Read this month ledger. Calculate this week vs last week: total revenue, total expenses, top 3 customers by payment amount, top products mentioned. Check all pending receivables. Send a comprehensive but concise weekly summary via Telegram. Use Hinglish.",
    "deliver": true,
    "channel": "telegram",
    "bestEffortDeliver": true
  }
}'
```

**Acceptance:** Force-run each cron job manually with `openclaw cron run <job-name>`. Verify Telegram messages arrive.

---

## Phase 5: Document Intelligence

### Task 5.1: Create Document Intel SKILL.md

**File: `~/.openclaw/workspace/skills/document-intel/SKILL.md`**

This skill handles photos and voice notes sent via Telegram.

Must include:
- Photo processing: identify document type (invoice, bill, receipt, handwritten note)
- Instruct the LLM to use its built-in vision capabilities to read the photo
- Extract: amounts, dates, party names, line items, GST numbers
- Update relevant workspace files after extraction
- Voice note processing: use OpenClaw's built-in transcription
- Handle Hindi/English/mixed language in documents
- Always confirm extraction to user with key details

**Note:** OpenClaw's Telegram integration already handles photo + voice note receipt and passes them to the agent as images/transcripts. The skill just needs to instruct the agent on what to DO with them.

**Acceptance:** Send a photo of an invoice to the Telegram bot. Bot extracts key data and confirms.

---

### Task 5.2: Create OCR Fallback Script (Optional Enhancement)

If the LLM's built-in vision isn't sufficient for handwritten Hindi text, create a fallback using Tesseract:

```bash
# Install inside proot Ubuntu
apt install -y tesseract-ocr tesseract-ocr-hin tesseract-ocr-eng
```

**File: `~/.openclaw/workspace/skills/document-intel/scripts/ocr.sh`**
```bash
#!/bin/bash
# OCR script for invoice/document processing
# Usage: ./ocr.sh <image_path> [language]
# Language: eng (default), hin, eng+hin

IMG="$1"
LANG="${2:-eng+hin}"

if [ ! -f "$IMG" ]; then
  echo '{"error": "File not found: '$IMG'"}'
  exit 1
fi

TEXT=$(tesseract "$IMG" stdout -l "$LANG" 2>/dev/null)
echo "$TEXT"
```

**Acceptance:** `./ocr.sh test-invoice.jpg eng+hin` returns readable text from an image.

---

### Task 5.3: Test Document Pipeline End-to-End

1. Send a photo of a real hardware store invoice to the Telegram bot
2. Bot should extract: seller name, buyer name, items, quantities, amounts, date
3. Bot should update contacts and ledger based on extracted data
4. Bot should confirm: "Invoice padh liya: Raj Steel → 500kg TMT → ₹29,500"

**Acceptance:** Full pipeline works for at least 3 different document types (printed invoice, handwritten bill, receipt photo).

---

## Phase 6: Anonymization Layer

### Task 6.1: Build Anonymization Module

**File: `~/.openclaw/workspace/lib/anonymize.js`**

```javascript
// PII Anonymization/De-anonymization for LLM calls
// Strips names, phones, accounts before sending to cloud
// Restores them after receiving LLM response

const { PATHS, readJSON, writeJSON } = require('./utils');

function loadAnonMap() {
  return readJSON(PATHS.anonMap) || {
    people: {}, phones: {}, accounts: {}, reverse_people: {}
  };
}

function saveAnonMap(map) {
  writeJSON(PATHS.anonMap, map);
}

function anonymize(text) {
  const map = loadAnonMap();
  let result = text;

  // Load known contacts for name matching
  const contactData = readJSON(PATHS.contacts);
  const contacts = contactData ? contactData.contacts : [];

  // 1. Replace known contact names with their IDs
  // Sort by name length (longest first) to avoid partial matches
  const sortedContacts = [...contacts].sort(
    (a, b) => b.name.length - a.name.length
  );
  
  for (const contact of sortedContacts) {
    if (!contact.name || contact.name.length < 2) continue;
    const escaped = contact.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    if (regex.test(result)) {
      map.people[contact.name] = contact.id;
      map.reverse_people[contact.id] = contact.name;
      result = result.replace(regex, contact.id);
    }
  }

  // 2. Replace phone numbers (+91XXXXXXXXXX or 10-digit)
  result = result.replace(/(\+91[-\s]?\d{10}|\b[6-9]\d{9}\b)/g, (match) => {
    if (!map.phones[match]) {
      map.phones[match] = `PHONE-${String(
        Object.keys(map.phones).length + 1
      ).padStart(3, '0')}`;
    }
    return map.phones[match];
  });

  // 3. Replace bank account fragments
  result = result.replace(
    /(?:a\/c|acct?|account)\s*(?:no\.?\s*)?([X*]*\d{4,})/gi,
    'A/c REDACTED'
  );

  // 4. Replace UPI IDs (name@bank format)
  result = result.replace(/[\w.]+@[a-zA-Z]{2,}/g, 'UPI-REDACTED');

  saveAnonMap(map);
  return result;
}

function deanonymize(text) {
  const map = loadAnonMap();
  let result = text;

  // Replace contact IDs back with names
  for (const [id, name] of Object.entries(map.reverse_people)) {
    const regex = new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, name);
  }

  return result;
}

// If run directly, test with stdin
if (require.main === module) {
  const input = process.argv[2] || 'Sharma ji ka phone 9876543210, a/c XX1234, UPI sharma@hdfc';
  console.log('Input:', input);
  console.log('Anonymized:', anonymize(input));
  console.log('De-anonymized:', deanonymize(anonymize(input)));
}

module.exports = { anonymize, deanonymize };
```

**Acceptance:** `node anonymize.js "Sharma ji ka ₹15000 pending hai, phone 9876543210"` → outputs text with "C-001" instead of "Sharma ji" and phone stripped.

---

### Task 6.2: Integrate Anonymization into SOUL.md

See Task 7.2.

### Task 6.3: Test Anonymization Round-Trip

1. Add "Sharma ji" to contacts.json with id "C-001"
2. Run anonymize on: "Sharma ji ka ₹15,000 pending hai, phone 9876543210, account XX1234"
3. Verify output: "C-001 ka ₹15,000 pending hai, phone PHONE-001, A/c REDACTED"
4. Run deanonymize on the output
5. Verify: "Sharma ji ka ₹15,000 pending hai, phone PHONE-001, A/c REDACTED"
   (Note: phone/account are one-way stripped, not restored — by design)

**Acceptance:** Round-trip works. Names restore. Phones and accounts stay redacted.

---

## Phase 7: Agent Personality & Configuration

### Task 7.1: Create AGENTS.md

**File: `~/.openclaw/workspace/AGENTS.md`**

```markdown
# DhandhaPhone Agent

You are DhandhaPhone — an AI business assistant for Indian small
business owners. You run on their spare phone and help them track
money, manage customers, and run their business smarter.

## Your Personality
- You are a smart, reliable business manager
- You speak Hinglish (Hindi-English mix) naturally
- You are concise — business owners are busy
- You are proactive — suggest actions, don't wait to be asked
- You are respectful — use "ji" suffix, "aap", polite Hindi
- You NEVER lecture or give long explanations
- You confirm data extraction BRIEFLY then move on

## Your Capabilities
- Read bank SMS and track all transactions automatically
- Remember every conversation and extract business data
- Send morning briefings and end-of-day summaries
- Process photos of invoices and bills
- Answer financial questions from the ledger
- Draft payment reminders and messages
- Track inventory and alert on low stock

## Your Limitations
- You cannot make payments or transfer money
- You cannot access WhatsApp (by design)
- You cannot browse the internet
- You rely on the owner to confirm before sending messages to people
```

---

### Task 7.2: Create SOUL.md

**File: `~/.openclaw/workspace/SOUL.md`**

```markdown
# DhandhaPhone Core Rules

## Language
Match the user's language. If they write Hindi, respond Hindi.
If Hinglish, respond Hinglish. If English, respond English.
Default: Hinglish (Hindi-English mix).

## Response Length
- Confirmations: 1-2 lines max
- Financial answers: number + brief context
- Briefings: under 200 words
- NEVER write paragraphs when a sentence will do

## Privacy (MANDATORY)
Before including ANY business data in an LLM prompt:
1. Replace customer/supplier names with their contact IDs (C-001, S-001)
2. Strip all phone numbers
3. Strip all bank account numbers and UPI IDs
4. KEEP amounts, dates, product names, quantities — these are safe
5. After receiving LLM response, replace IDs back to real names

The anonymization scripts are at workspace/lib/anonymize.js.

## Data Handling
- All business data lives in workspace/ directories
- ALWAYS read actual files for financial answers — never guess
- ALWAYS update files when the owner mentions business events
- Append to ledger files — never modify old entries
- Update summary.json after any ledger change

## Proactive Behavior
- If a large payment comes in (>₹5000), alert immediately
- If stock drops below reorder_point, mention in next briefing
- If a receivable is >7 days overdue, suggest a reminder
- NEVER spam — only alert on genuinely important events

## Confirmation Pattern
When extracting data from conversation:
"Got it — [brief summary of what was recorded]"
NOT: "I have extracted the following information from your message
and updated the following files..."

## Error Handling
If a file is missing or corrupted, recreate it with empty defaults.
Never crash or show error messages to the user. Log errors silently
and continue working.
```

---

### Task 7.3: Create HEARTBEAT.md

**File: `~/.openclaw/workspace/HEARTBEAT.md`**

```markdown
# Business Monitor Heartbeat

Every 30 minutes, perform these checks:

1. **New SMS**: Run `node workspace/skills/sms-ledger/scripts/sms-poller.js`
   If new transactions found, check if any are >₹5000. If yes, alert
   the owner on Telegram with amount and counterparty.

2. **Overdue Payments**: Read workspace/pending/actions.json.
   Check for any payment_reminder where status=pending and
   due_date is more than 7 days ago. If found and not already
   alerted today, mention in a brief alert.

3. **Battery Check**: Run battery status check. If below 20% and
   not charging, alert the owner: "DhandhaPhone ki battery kam hai,
   charge karo!"

4. **Gateway Health**: Verify the gateway is still connected to
   Telegram. If not, attempt reconnection.

IMPORTANT: Most heartbeats should end with HEARTBEAT_OK.
Only message the owner if something genuinely needs attention.
Do NOT send "no new messages" or "everything is fine" updates.
```

---

### Task 7.4: Update openclaw.json Configuration

Ensure the OpenClaw configuration has:
- Telegram channel configured
- Correct model selected
- Heartbeat enabled with 30-minute interval
- Skills directory pointed to workspace/skills
- Workspace path set correctly

```bash
# Verify/update key settings
openclaw config set heartbeat.enabled true
openclaw config set heartbeat.interval 30
openclaw config set agents.defaults.workspace ~/.openclaw/workspace
```

**Acceptance:** `openclaw config get heartbeat` shows enabled=true, interval=30.

---

## Phase 8: Cloud LLM Router (Backend)

This runs on YOUR server, not on the phone.

### Task 8.1: Create FastAPI LLM Router

**File: `server/main.py`**

```python
"""
DhandhaPhone Cloud LLM Router
Routes anonymized requests to the cheapest capable model.
"""
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import httpx
import os
import time
import json

app = FastAPI(title="DhandhaPhone LLM Router")

# --- Config ---
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY") 
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")

# --- Models ---
class ChatRequest(BaseModel):
    messages: list[dict]
    tier: str = "simple"  # simple, medium, complex
    max_tokens: int = 1000

class ChatResponse(BaseModel):
    content: str
    model_used: str
    tokens_used: int
    cost_inr: float

# --- Device Auth (basic for MVP) ---
VALID_DEVICES = {}  # In production: database lookup

def verify_device(device_id: str, api_key: str):
    # MVP: accept all. Production: validate against DB
    return True

# --- Routing ---
async def call_gemini(messages, max_tokens):
    """Tier 1: Gemini Flash — cheapest, fastest"""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}",
            json={
                "contents": [{"parts": [{"text": m["content"]}]} for m in messages if m["role"] == "user"],
                "generationConfig": {"maxOutputTokens": max_tokens}
            }
        )
        data = resp.json()
        text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return text, 0.1  # Approximate cost in INR

async def call_deepseek(messages, max_tokens):
    """Tier 2: DeepSeek V3 — good reasoning, moderate cost"""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"},
            json={
                "model": "deepseek-chat",
                "messages": messages,
                "max_tokens": max_tokens
            }
        )
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        tokens = data.get("usage", {}).get("total_tokens", 0)
        return text, tokens * 0.0001  # Approximate INR

async def call_claude(messages, max_tokens):
    """Tier 3: Claude Sonnet — best reasoning, highest cost"""
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": max_tokens,
                "messages": messages
            }
        )
        data = resp.json()
        text = data["content"][0]["text"]
        input_tokens = data.get("usage", {}).get("input_tokens", 0)
        output_tokens = data.get("usage", {}).get("output_tokens", 0)
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 85  # USD to INR
        return text, cost

@app.post("/v1/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    x_device_id: str = Header(...),
    x_api_key: str = Header(...)
):
    if not verify_device(x_device_id, x_api_key):
        raise HTTPException(401, "Invalid device credentials")
    
    try:
        if req.tier == "simple":
            text, cost = await call_gemini(req.messages, req.max_tokens)
            model = "gemini-flash"
        elif req.tier == "medium":
            text, cost = await call_deepseek(req.messages, req.max_tokens)
            model = "deepseek-v3"
        elif req.tier == "complex":
            text, cost = await call_claude(req.messages, req.max_tokens)
            model = "claude-sonnet"
        else:
            text, cost = await call_gemini(req.messages, req.max_tokens)
            model = "gemini-flash"
        
        return ChatResponse(
            content=text,
            model_used=model,
            tokens_used=0,  # Simplified for MVP
            cost_inr=round(cost, 2)
        )
    except Exception as e:
        # Fallback chain: try next tier
        if req.tier == "medium":
            text, cost = await call_gemini(req.messages, req.max_tokens)
            return ChatResponse(content=text, model_used="gemini-flash-fallback",
                              tokens_used=0, cost_inr=round(cost, 2))
        raise HTTPException(500, f"LLM call failed: {str(e)}")

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": time.time()}
```

**File: `server/requirements.txt`**
```
fastapi>=0.100.0
uvicorn>=0.23.0
httpx>=0.24.0
pydantic>=2.0.0
```

### Task 8.2: Create Server Deployment Script

```bash
# server/run.sh
#!/bin/bash
export GEMINI_API_KEY="your-key"
export DEEPSEEK_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-key"

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

### Task 8.3: Test LLM Router

```bash
curl -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: test-001" \
  -H "X-API-Key: test-key" \
  -d '{
    "messages": [{"role": "user", "content": "Customer C-007 has ₹15,000 pending for 5 days. Draft a polite Hindi payment reminder."}],
    "tier": "simple"
  }'
```

**Acceptance:** Returns a Hindi payment reminder draft. Response time < 5 seconds.

### Task 8.4: Configure OpenClaw to Use Custom Router

For production, configure OpenClaw to route LLM calls through your backend. For MVP, using Gemini API directly via OpenClaw's built-in model configuration is fine.

**Acceptance:** End-to-end flow works — phone → Telegram → OpenClaw → LLM → response → Telegram.

---

## Phase 9: Integration & Hardening

### Task 9.1: End-to-End Test Suite

Create a manual test script that validates the full system:

```markdown
## E2E Test Checklist

### SMS Pipeline
[ ] Send fake bank SMS → appears in ledger within 5 minutes
[ ] Send 3 SMS rapidly → no duplicates in ledger
[ ] OTP SMS → correctly ignored
[ ] Promotional SMS → correctly ignored
[ ] Manual "cash mein 2000 mila" → logged as manual transaction

### Conversation Memory
[ ] "Sharma ne 50 bags order diya" → Sharma in contacts, stock updated
[ ] "Gupta ka delivery aaya, 30 bags, 15000" → supplier updated, inventory up
[ ] "Mehta ne 3 bag return kiya" → inventory adjusted, contact noted
[ ] "Kitna stock bacha hai?" → accurate answer from stock.json

### Briefings
[ ] Morning briefing arrives at 7 AM with real data
[ ] EOD summary arrives at 9 PM with today's actual numbers
[ ] Weekly report arrives Sunday 8 PM

### Financial Queries
[ ] "Aaj kitna aaya?" → matches ledger sum
[ ] "Week ka total?" → matches weekly summary
[ ] "Sharma ne pay kiya?" → correctly searches ledger
[ ] "Sabse bada customer kaun hai?" → ranks by balance

### Photo Processing
[ ] Send invoice photo → key data extracted and logged
[ ] Send handwritten bill photo → reasonable extraction attempt

### Alerts
[ ] Large payment (>₹5000) → proactive Telegram alert
[ ] Battery low (<20%) → warning sent
[ ] Stock below reorder → mentioned in briefing

### Privacy
[ ] Grep LLM logs for real names → none found
[ ] Check .anon-map.json → mappings correct
[ ] Anonymize/deanonymize round-trip works
```

### Task 9.2: Battery & Process Stability

```bash
# Create a watchdog script that restarts OpenClaw if it dies
cat > ~/.openclaw/watchdog.sh << 'WATCHDOG'
#!/bin/bash
while true; do
  if ! pgrep -f "openclaw gateway" > /dev/null; then
    echo "[$(date)] Gateway died, restarting..." >> ~/.openclaw/watchdog.log
    cd /root
    export NODE_OPTIONS="--require ~/.openclaw/bionic-bypass.js"
    nohup openclaw gateway --verbose >> ~/.openclaw/gateway.log 2>&1 &
  fi
  sleep 60
done
WATCHDOG
chmod +x ~/.openclaw/watchdog.sh
```

**Start on boot:**
```bash
# Add to .bashrc inside proot Ubuntu
echo 'nohup bash ~/.openclaw/watchdog.sh &' >> ~/.bashrc
```

### Task 9.3: Log Rotation

Prevent ledger and log files from growing indefinitely:

```bash
# Monthly log rotation (add as cron job)
openclaw cron add --json '{
  "name": "log-rotation",
  "schedule": {"kind": "cron", "expr": "0 3 1 * *", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Rotate old log files. Compress gateway logs older than 7 days. Check disk space with df -h and alert if >80% used. Compact old ledger files if needed.",
    "deliver": false
  }
}'
```

### Task 9.4: Error Recovery

If any workspace JSON file is corrupted, recreate with defaults:

**File: `~/.openclaw/workspace/lib/repair.js`**
```javascript
#!/usr/bin/env node
// Repairs corrupted workspace files by recreating with defaults
const { PATHS, readJSON, writeJSON } = require('./utils');

const defaults = {
  [PATHS.contacts]: { contacts: [], next_customer_id: 1, next_supplier_id: 1, next_staff_id: 1 },
  [PATHS.inventory]: { items: [], last_updated: "" },
  [PATHS.pending]: { actions: [], next_id: 1 },
  [PATHS.summary]: { today: {credits:0,debits:0,count:0,date:""}, this_week: {credits:0,debits:0,count:0}, this_month: {credits:0,debits:0,count:0}, last_updated: "" },
  [PATHS.anonMap]: { people: {}, phones: {}, accounts: {}, reverse_people: {} },
};

let repaired = 0;
for (const [filepath, defaultData] of Object.entries(defaults)) {
  const data = readJSON(filepath);
  if (!data) {
    console.log(`Repairing: ${filepath}`);
    writeJSON(filepath, defaultData);
    repaired++;
  }
}

console.log(repaired > 0 ? `Repaired ${repaired} files.` : 'All files OK.');
```

**Acceptance:** Delete contacts.json, run `node repair.js`, verify it's recreated. System continues working.

---

## Phase 10: Setup Automation Script

### Task 10.1: One-Command Setup Script

**File: `setup-dhandhaphone.sh`**

A single script that a developer (you) runs on a fresh Termux+proot setup to install everything.

```bash
#!/bin/bash
# DhandhaPhone Setup Script
# Run inside proot Ubuntu on Android
# Prerequisites: Termux + Termux:API + proot-distro Ubuntu + Node.js 22

set -e

echo "🏪 DhandhaPhone Setup Starting..."

WORKSPACE="$HOME/.openclaw/workspace"

# 1. Create directory structure
echo "📁 Creating workspace..."
mkdir -p "$WORKSPACE"/{skills/{sms-ledger/scripts,business-memory/scripts,business-briefing/scripts,document-intel/scripts},ledger,contacts,inventory,pending,sms,ocr,lib}

# 2. Copy all skill files, scripts, and configs
echo "📝 Installing skills..."
# [This section copies all the SKILL.md files and scripts created in Phases 2-7]
# In practice, clone from your git repo:
# git clone https://github.com/exargen/dhandhaphone.git /tmp/dhandhaphone
# cp -r /tmp/dhandhaphone/skills/* "$WORKSPACE/skills/"
# cp -r /tmp/dhandhaphone/lib/* "$WORKSPACE/lib/"
# cp /tmp/dhandhaphone/AGENTS.md "$WORKSPACE/"
# cp /tmp/dhandhaphone/SOUL.md "$WORKSPACE/"
# cp /tmp/dhandhaphone/HEARTBEAT.md "$WORKSPACE/"

# 3. Initialize data files
echo "💾 Initializing data..."
echo '{"contacts":[],"next_customer_id":1,"next_supplier_id":1,"next_staff_id":1}' > "$WORKSPACE/contacts/contacts.json"
echo '{"items":[],"last_updated":""}' > "$WORKSPACE/inventory/stock.json"
echo '{"actions":[],"next_id":1}' > "$WORKSPACE/pending/actions.json"
echo '{"today":{"credits":0,"debits":0,"count":0,"date":""},"this_week":{"credits":0,"debits":0,"count":0},"this_month":{"credits":0,"debits":0,"count":0},"last_updated":""}' > "$WORKSPACE/ledger/summary.json"
echo '0' > "$WORKSPACE/sms/last_processed_id.txt"
echo '{"people":{},"phones":{},"accounts":{},"reverse_people":{}}' > "$WORKSPACE/.anon-map.json"

# 4. Make scripts executable
chmod +x "$WORKSPACE"/skills/*/scripts/*.sh 2>/dev/null || true
chmod +x "$WORKSPACE"/lib/*.sh 2>/dev/null || true

# 5. Set up bionic bypass
echo "🔧 Configuring Bionic Bypass..."
cat > "$HOME/.openclaw/bionic-bypass.js" << 'EOF'
const os = require('os');
const orig = os.networkInterfaces;
os.networkInterfaces = function() {
  try { const r = orig.call(os); if (r && Object.keys(r).length > 0) return r; } catch {}
  return { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
};
EOF

echo 'export NODE_OPTIONS="--require $HOME/.openclaw/bionic-bypass.js"' >> "$HOME/.bashrc"
source "$HOME/.bashrc"

# 6. Set up watchdog
echo "🐕 Installing watchdog..."
cat > "$HOME/.openclaw/watchdog.sh" << 'WATCHDOG'
#!/bin/bash
while true; do
  if ! pgrep -f "openclaw gateway" > /dev/null; then
    echo "[$(date)] Restarting gateway..." >> "$HOME/.openclaw/watchdog.log"
    export NODE_OPTIONS="--require $HOME/.openclaw/bionic-bypass.js"
    nohup openclaw gateway --verbose >> "$HOME/.openclaw/gateway.log" 2>&1 &
  fi
  sleep 60
done
WATCHDOG
chmod +x "$HOME/.openclaw/watchdog.sh"

echo ""
echo "✅ DhandhaPhone installed!"
echo ""
echo "Next steps:"
echo "1. Run: openclaw onboard"
echo "   → Select Telegram as channel"
echo "   → Select Gemini (free) or your preferred model"
echo "   → Select Loopback (127.0.0.1) for binding"
echo ""
echo "2. Start the gateway: openclaw gateway --verbose"
echo ""
echo "3. Register cron jobs (run these after gateway is up):"
echo "   openclaw cron add --json '{...}'  # See build_plan.md Phase 4"
echo ""
echo "4. Message your Telegram bot to test!"
echo ""
```

### Task 10.2: Create Git Repository Structure

```
dhandhaphone/
├── README.md
├── context.md              # This file
├── build_plan.md           # This file
├── setup-dhandhaphone.sh   # One-command installer
├── skills/
│   ├── sms-ledger/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       ├── sms-parser.js
│   │       ├── sms-poller.js
│   │       ├── ledger-query.js
│   │       ├── rebuild-summary.js
│   │       └── test-parser.js
│   ├── business-memory/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── contact-lookup.js
│   ├── business-briefing/
│   │   └── SKILL.md
│   └── document-intel/
│       ├── SKILL.md
│       └── scripts/
│           └── ocr.sh
├── lib/
│   ├── utils.js
│   ├── termux-api.js
│   ├── termux-bridge.sh
│   ├── anonymize.js
│   └── repair.js
├── config/
│   ├── AGENTS.md
│   ├── SOUL.md
│   └── HEARTBEAT.md
├── server/                 # Cloud backend (runs on your server)
│   ├── main.py
│   ├── requirements.txt
│   └── run.sh
└── tests/
    ├── test-parser.js
    └── e2e-checklist.md
```

### Task 10.3: Create README.md

Write a concise README covering:
- What DhandhaPhone is (2 sentences)
- Prerequisites (Termux, Termux:API, proot Ubuntu, Node.js 22, OpenClaw)
- Quick start (3 commands)
- Architecture diagram (ASCII)
- License

**Acceptance:** A new developer can go from zero to running DhandhaPhone in under 30 minutes following the README.

---

## Priority Order (If Time-Constrained)

If you can only build part of this, prioritize in this order:

1. **Phase 2 (SMS Engine)** — This alone justifies the product. "It auto-tracks every payment" is the killer feature.
2. **Phase 4 (Briefings)** — Morning briefing is the habit-forming hook.
3. **Phase 3 (Memory)** — Makes the bot feel intelligent.
4. **Phase 7 (SOUL/AGENTS)** — Makes the tone right.
5. **Phase 6 (Anonymization)** — Important but can be added after pilot.
6. **Phase 5 (Documents)** — Nice to have, not critical for MVP.
7. **Phase 8 (Cloud Router)** — Only needed when you outgrow Gemini free tier.

**Absolute minimum viable product:** Phases 1 + 2 + 4 + 7 = SMS auto-tracking + daily briefings + good personality. This can be built in ~7 days.
