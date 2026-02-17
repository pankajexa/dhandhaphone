#!/usr/bin/env node
// Rebuilds summary.json from the JSONL ledger files
// Used as a recovery tool if summary gets corrupted

const path = require('path');
const libDir = path.join(__dirname, '..', '..', '..', 'lib');

// We need utils for PATHS
const utils = require(path.join(libDir, 'utils'));

// Import updateSummary from sms-poller (same directory)
const { updateSummary } = require('./sms-poller');

const summary = updateSummary();
console.log('Summary rebuilt:');
console.log(JSON.stringify(summary, null, 2));
