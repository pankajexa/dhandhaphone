#!/usr/bin/env node
// gateway/ingestion/notification-poller.js — Standalone notification poller for DhandhaPhone
// Polls termux-notification-list every 2 minutes (called by heartbeat).
// Integrates: parser registry, three-tier dedup, VPA resolver, platform accounting, confidence scoring.

'use strict';

const path = require('path');
const crypto = require('crypto');

// Resolve lib paths (works whether called directly or via workspace symlink)
const libDir = path.join(__dirname, '..', '..', 'lib');
const { getNotifications } = require(path.join(libDir, 'termux-api'));
const { getDB } = require(path.join(libDir, 'utils'));

const { NotificationParserRegistry } = require('./notification-parser');
const { DedupEngine } = require('./dedup');
const { VPAResolver } = require('./vpa-resolver');
const { getConfidence, getDecision } = require('./confidence');
const { PlatformAccountant } = require('./platform-accounting');

// Platforms that use order-vs-settlement accounting
const PLATFORM_APPS = new Set([
  'in.swiggy.partner.app',
  'com.application.zomato.merchant',
  'com.amazon.sellermobile.android',
  'com.flipkart.seller'
]);

const PLATFORM_NAMES = {
  'in.swiggy.partner.app': 'Swiggy',
  'com.application.zomato.merchant': 'Zomato',
  'com.amazon.sellermobile.android': 'Amazon',
  'com.flipkart.seller': 'Flipkart'
};

class NotificationPoller {
  /**
   * @param {Object} db - DhandhaDB instance
   */
  constructor(db) {
    this.db = db;
    this.registry = new NotificationParserRegistry();
    this.dedup = new DedupEngine(db);
    this.vpaResolver = new VPAResolver(db);
    this.platformAccountant = new PlatformAccountant(db);
  }

  /**
   * Main poll loop. Fetches notifications, filters, parses, deduplicates, and stores.
   * @returns {Promise<Array>} Array of result objects for each processed notification
   */
  async poll() {
    // 1. Get all current notifications from Android
    let allNotifications;
    try {
      allNotifications = await getNotifications();
    } catch (err) {
      console.error('[NotifPoller] Failed to read notifications:', err.message);
      return [];
    }

    if (!allNotifications || allNotifications.length === 0) return [];

    // 2. Filter to monitored apps only
    const monitored = allNotifications.filter(
      n => n.packageName && this.registry.getParser(n.packageName)
    );

    if (monitored.length === 0) return [];

    // 3. Process each notification
    const results = [];
    for (const notif of monitored) {
      try {
        const result = this.processNotification(notif);
        if (result) results.push(result);
      } catch (err) {
        console.error(
          `[NotifPoller] Error processing ${notif.packageName}:`,
          err.message
        );
        // Log the error so we don't re-attempt this notification
        try {
          const hash = this.hashNotification(notif);
          this.db.logNotification(hash, notif.packageName, 'error');
        } catch (_) { /* best effort */ }
      }
    }

    return results;
  }

  /**
   * Process a single notification through the full pipeline.
   * @param {Object} notif - Raw notification from termux-notification-list
   * @returns {Object|null} Result object or null if skipped/duplicate
   */
  processNotification(notif) {
    // ── Step 1: Notification-level dedup ──────────────────────────
    const notifHash = this.hashNotification(notif);
    const alreadyProcessed = this.db.getNotificationByHash(notifHash);
    if (alreadyProcessed) return null;

    // ── Step 2: Parse with app-specific parser ───────────────────
    const parserEntry = this.registry.getParser(notif.packageName);
    const parsed = parserEntry.parse(notif.title || '', notif.content || '');

    if (!parsed || parsed.amount == null) {
      // Not a financial notification (promotional, KOT, etc.)
      this.db.logNotification(notifHash, notif.packageName, 'skipped');
      return null;
    }

    // ── Step 3: VPA resolution ───────────────────────────────────
    // If counterparty looks like a VPA (e.g. from BHIM), resolve to contact
    if (parsed.counterparty) {
      const vpa = this.vpaResolver.extractVPA(parsed.counterparty);
      if (vpa) {
        const resolved = this.vpaResolver.resolve(vpa);
        if (resolved) {
          parsed.counterparty = resolved.contact_name;
          parsed.counterparty_id = resolved.contact_id;
        }
      }
    }

    // ── Step 4: Platform order handling ──────────────────────────
    // For Swiggy/Zomato/Amazon/Flipkart: orders are pending credits, not real income yet
    if (PLATFORM_APPS.has(notif.packageName) && parsed.category === 'platform_pending') {
      return this.processPlatformOrder(notif, notifHash, parserEntry, parsed);
    }

    // For platform settlements
    if (PLATFORM_APPS.has(notif.packageName) && parsed.isSettlement) {
      return this.processPlatformSettlement(notif, notifHash, parserEntry, parsed);
    }

    // ── Step 5: Cross-channel dedup (was this already captured by SMS?) ──
    const txnDate = notif.when
      ? new Date(notif.when).toISOString()
      : new Date().toISOString();

    const dupCheck = this.dedup.isDuplicate({
      amount: parsed.amount,
      type: parsed.type,
      reference_id: parsed.reference_id || null,
      counterparty: parsed.counterparty || null,
      transaction_date: txnDate
    }, 'notification');

    if (dupCheck.isDupe) {
      this.db.logNotification(notifHash, notif.packageName, 'duplicate', dupCheck.matchedTxnId);
      return null;
    }

    // ── Step 6: Determine confidence and decision ────────────────
    const subtype = parsed.reference_id ? 'upi_with_ref' : 'upi_without_ref';
    const confidence = parsed.confidence || getConfidence('notification', subtype);
    const decision = getDecision(confidence);

    // ── Step 7: Write transaction ────────────────────────────────
    const txnId = this.db.addTransaction({
      type: parsed.type,
      amount: parsed.amount,
      counterparty_id: parsed.counterparty_id || null,
      counterparty_name: parsed.counterparty || null,
      method: parsed.method || 'UPI',
      source: 'notification',
      category: parsed.category || null,
      reference_id: parsed.reference_id || null,
      original_message: `[${parserEntry.name}] ${notif.title || ''}: ${notif.content || ''}`,
      confidence: confidence,
      is_confirmed: decision === 'auto_confirm' ? 1 : 0,
      transaction_date: txnDate.split('T')[0]
    });

    // ── Step 8: Record in dedup log for future cross-channel matching ──
    this.dedup.recordTransaction({
      amount: parsed.amount,
      type: parsed.type,
      reference_id: parsed.reference_id || null,
      transaction_date: txnDate
    }, 'notification', txnId);

    // ── Step 9: Log notification as captured ─────────────────────
    this.db.logNotification(notifHash, notif.packageName, 'captured', txnId);

    // ── Step 10: Save VPA mapping if we learned a new one ────────
    if (parsed.counterparty_id && parsed.reference_id) {
      const vpa = this.vpaResolver.extractVPA(notif.content || '');
      if (vpa) {
        this.db.saveVPAMapping(vpa, parsed.counterparty_id, parsed.counterparty);
      }
    }

    return {
      transaction_id: txnId,
      app: parserEntry.name,
      category: parserEntry.category,
      amount: parsed.amount,
      type: parsed.type,
      counterparty: parsed.counterparty || null,
      confidence,
      decision,
      alertLevel: parserEntry.alertLevel
    };
  }

  /**
   * Handle platform order notifications (Swiggy/Zomato/Amazon/Flipkart).
   * These are NOT real income yet — they're pending credits.
   */
  processPlatformOrder(notif, notifHash, parserEntry, parsed) {
    const platform = PLATFORM_NAMES[notif.packageName];

    const txnId = this.platformAccountant.logPlatformOrder(parsed, platform);

    this.db.logNotification(notifHash, notif.packageName, 'captured', txnId);

    return {
      transaction_id: txnId,
      app: parserEntry.name,
      category: 'platform_order',
      amount: parsed.amount,
      type: 'pending_credit',
      counterparty: platform,
      orderId: parsed.orderId,
      confidence: parsed.confidence,
      decision: 'platform_pending',
      alertLevel: parserEntry.alertLevel
    };
  }

  /**
   * Handle platform settlement notifications.
   * This is real money arriving — reconcile against pending orders.
   */
  processPlatformSettlement(notif, notifHash, parserEntry, parsed) {
    const platform = PLATFORM_NAMES[notif.packageName];

    const result = this.platformAccountant.logPlatformSettlement(parsed, platform);

    this.db.logNotification(notifHash, notif.packageName, 'captured', result.settlementTxnId);

    // Also record in dedup log (settlement hits bank account, so SMS may also arrive)
    this.dedup.recordTransaction({
      amount: parsed.amount,
      type: 'credit',
      reference_id: parsed.reference_id || null,
      transaction_date: new Date().toISOString()
    }, 'notification', result.settlementTxnId);

    return {
      transaction_id: result.settlementTxnId,
      app: parserEntry.name,
      category: 'platform_settlement',
      amount: parsed.amount,
      type: 'credit',
      counterparty: `${platform} Settlement`,
      confidence: getConfidence('notification', 'platform_settlement'),
      decision: 'auto_confirm',
      alertLevel: 'normal',
      reconciliation: {
        ordersReconciled: result.ordersReconciled,
        commissionAmount: result.commissionTxnId ? result.estimatedCommission : 0,
        commissionTxnId: result.commissionTxnId || null
      }
    };
  }

  /**
   * Compute a unique hash for a notification instance.
   * Uses packageName + id + when + content to avoid re-processing.
   */
  hashNotification(notif) {
    const raw = [
      notif.packageName || '',
      notif.id || '',
      notif.when || '',
      notif.content || ''
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLI entry point — run by heartbeat every 2 minutes
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const db = getDB();
  const poller = new NotificationPoller(db);

  const results = await poller.poll();

  if (results.length === 0) {
    // Nothing new — silent exit (no noise in heartbeat logs)
    process.exit(0);
  }

  // Output results as JSON for the agent to read
  const output = {
    timestamp: new Date().toISOString(),
    processed: results.length,
    transactions: results.map(r => ({
      id: r.transaction_id,
      app: r.app,
      category: r.category,
      amount: r.amount,
      type: r.type,
      counterparty: r.counterparty,
      confidence: r.confidence,
      decision: r.decision,
      alertLevel: r.alertLevel
    })),
    // Separate out items needing immediate attention
    immediate: results.filter(r => r.alertLevel === 'immediate'),
    needsConfirmation: results.filter(r => r.decision === 'ask_owner')
  };

  console.log(JSON.stringify(output, null, 2));

  // Exit with code 0 (success) even if some need confirmation
  // The agent reads the JSON and decides how to alert
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[NotifPoller] Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { NotificationPoller };
