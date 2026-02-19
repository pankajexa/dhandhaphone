#!/usr/bin/env node
// Quick contact lookup tool for the business memory skill
// Usage: node contact-lookup.js "sharma"
// Returns matching contacts as JSON
// Uses SQLite DB (preferred) with flat-file fallback

const path = require('path');
const libDir = path.join(__dirname, '..', '..', '..', 'lib');
const { PATHS, readJSON, getDB } = require(path.join(libDir, 'utils'));

const query = process.argv[2];
if (!query) {
  console.log('Usage: node contact-lookup.js <name>');
  process.exit(1);
}

let matches;
try {
  const db = getDB();
  matches = db.findContact(query);
} catch (_e) {
  // Flat-file fallback
  const data = readJSON(PATHS.contacts);
  if (!data || !data.contacts) {
    console.log('[]');
    process.exit(0);
  }
  matches = data.contacts.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
}

console.log(JSON.stringify(matches, null, 2));
