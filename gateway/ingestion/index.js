// gateway/ingestion/index.js — Barrel export for all DhandhaPhone data ingestion modules

'use strict';

const { NotificationParserRegistry } = require('./notification-parser');
const { NotificationPoller } = require('./notification-poller');
const { DedupEngine } = require('./dedup');
const { VPAResolver } = require('./vpa-resolver');
const { PlatformAccountant } = require('./platform-accounting');
const { EODReconciliation } = require('./eod-reconciliation');
const { BulkImporter } = require('./bulk-import');
const { ChannelHealth } = require('./channel-health');
const { parseForwardedMessage } = require('./forwarded-message-parser');
const confidence = require('./confidence');

module.exports = {
  NotificationParserRegistry,
  NotificationPoller,
  DedupEngine,
  VPAResolver,
  PlatformAccountant,
  EODReconciliation,
  BulkImporter,
  ChannelHealth,
  parseForwardedMessage,
  confidence
};
