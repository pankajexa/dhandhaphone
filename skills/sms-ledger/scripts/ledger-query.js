#!/usr/bin/env node
// Query ledger for specific transactions
// Usage: node ledger-query.js [--today|--week|--month] [--type credit|debit] [--name SHARMA] [--min 1000]

const path = require('path');
const libDir = path.join(__dirname, '..', '..', '..', 'lib');
const { PATHS, readJSONL, currentMonth, todayISO } = require(path.join(libDir, 'utils'));

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
