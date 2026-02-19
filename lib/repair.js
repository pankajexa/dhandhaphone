#!/usr/bin/env node
// Repairs corrupted workspace files by recreating with defaults
// Also checks SQLite DB integrity

const path = require('path');
const { PATHS, readJSON, writeJSON } = require(path.join(__dirname, 'utils'));

const defaults = {
  [PATHS.contacts]: { contacts: [], next_customer_id: 1, next_supplier_id: 1, next_staff_id: 1 },
  [PATHS.inventory]: { items: [], last_updated: "" },
  [PATHS.pending]: { actions: [], next_id: 1 },
  [PATHS.summary]: {
    today: { credits: 0, debits: 0, count: 0, date: "" },
    this_week: { credits: 0, debits: 0, count: 0, week_start: "" },
    this_month: { credits: 0, debits: 0, count: 0, month: "" },
    last_updated: ""
  },
  [PATHS.anonMap]: { people: {}, phones: {}, accounts: {}, reverse_people: {} },
};

let repaired = 0;

// Check flat files
for (const [filepath, defaultData] of Object.entries(defaults)) {
  const data = readJSON(filepath);
  if (!data) {
    console.log(`Repairing: ${filepath}`);
    writeJSON(filepath, defaultData);
    repaired++;
  }
}

// Check SQLite DB integrity
try {
  const { getDB } = require(path.join(__dirname, 'utils'));
  const db = getDB();
  const result = db.agentQuery("SELECT 'ok' as status");
  if (result && result[0] && result[0].status === 'ok') {
    console.log('SQLite DB: OK');
  } else {
    console.log('SQLite DB: WARNING - unexpected query result');
    repaired++;
  }
} catch (e) {
  console.log(`SQLite DB: ERROR - ${e.message}`);
  repaired++;
}

console.log(repaired > 0 ? `Repaired ${repaired} files.` : 'All files OK.');
