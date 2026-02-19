// gateway/ingestion/platform-accounting.js — Platform business accounting for DhandhaPhone
// Handles the order-vs-settlement split for aggregator platforms (Swiggy, Zomato, Amazon, Flipkart).
// Platform orders are logged as PENDING credits; settlements reconcile them and compute commission.

'use strict';

/**
 * Default commission rate estimates per platform.
 * min/max bracket the typical range; default is the most common rate.
 */
const PLATFORM_COMMISSION_RATES = {
  'Swiggy':   { min: 0.15, max: 0.30, default: 0.22 },
  'Zomato':   { min: 0.18, max: 0.25, default: 0.20 },
  'Amazon':   { min: 0.05, max: 0.25, default: 0.15 },
  'Flipkart': { min: 0.05, max: 0.25, default: 0.15 },
};

class PlatformAccountant {
  /**
   * @param {Object} db - DhandhaDB instance (has .db for raw SQL, .addTransaction for inserts)
   */
  constructor(db) {
    this.db = db;
  }

  // ════════════════════════════════════════════════════════════════════
  // LOG PLATFORM ORDER — new order notification → pending credit
  // ════════════════════════════════════════════════════════════════════

  /**
   * Log a new platform order as a PENDING credit.
   * The money has NOT been received yet — the platform collects it and
   * will settle later (minus commission).
   *
   * @param {Object} parsed - Parsed notification result
   * @param {number} parsed.amount - Order value
   * @param {string} parsed.orderId - Platform order ID
   * @param {string|null} parsed.items - Item description (optional)
   * @param {number} parsed.confidence - Parser confidence score
   * @param {string} platform - Platform name (e.g. 'Swiggy')
   * @returns {number} Transaction ID of the pending credit
   */
  logPlatformOrder(parsed, platform) {
    const txnId = this.db.addTransaction({
      type: 'credit',
      amount: parsed.amount,
      counterparty_name: `${platform} Order #${parsed.orderId}`,
      method: 'PLATFORM',
      source: 'notification',
      category: 'platform_pending',
      reference_id: parsed.orderId,
      description: parsed.items || null,
      confidence: parsed.confidence,
      is_confirmed: 0,  // NOT confirmed until settled
      transaction_date: new Date().toISOString().split('T')[0]
    });

    return txnId;
  }

  // ════════════════════════════════════════════════════════════════════
  // LOG PLATFORM SETTLEMENT — reconcile pending orders with payout
  // ════════════════════════════════════════════════════════════════════

  /**
   * Reconcile pending platform orders against an incoming settlement.
   *
   * Flow:
   *   1. Find all unconfirmed pending orders for this platform
   *   2. Sum them to get gross order value
   *   3. Compute implied commission = gross - net settlement
   *   4. Mark pending orders as settled + confirmed
   *   5. Log the settlement as a confirmed bank credit
   *   6. Log implied commission as a debit (unconfirmed — owner should verify)
   *
   * @param {Object} parsed - Parsed settlement notification
   * @param {number} parsed.amount - Settlement (net) amount received
   * @param {number} parsed.confidence - Parser confidence score
   * @param {string} platform - Platform name (e.g. 'Swiggy')
   * @returns {{ ordersSettled: number, grossAmount: number, netReceived: number, impliedCommission: number }}
   */
  logPlatformSettlement(parsed, platform) {
    // Step 1: Find all pending orders for this platform
    const pendingOrders = this.db.db.prepare(`
      SELECT id, amount FROM transactions
      WHERE category = 'platform_pending'
        AND counterparty_name LIKE ?
        AND is_confirmed = 0 AND is_deleted = 0
      ORDER BY transaction_date ASC
    `).all(`${platform}%`);

    // Step 2: Compute gross total of pending orders
    const pendingTotal = pendingOrders.reduce(
      (sum, o) => sum + o.amount, 0
    );
    const settlementAmount = parsed.amount;
    const impliedCommission = pendingTotal - settlementAmount;

    // Step 3: Mark pending orders as settled and confirmed
    const updateStmt = this.db.db.prepare(`
      UPDATE transactions SET
        category = 'platform_settled',
        is_confirmed = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `);
    for (const order of pendingOrders) {
      updateStmt.run(order.id);
    }

    // Step 4: Log the settlement (actual money received in bank)
    const settlementTxnId = this.db.addTransaction({
      type: 'credit',
      amount: settlementAmount,
      counterparty_name: `${platform} Settlement`,
      method: 'BANK',
      source: 'notification',
      category: 'platform_settlement',
      confidence: parsed.confidence || 0.95,
      is_confirmed: 1,
      transaction_date: new Date().toISOString().split('T')[0]
    });

    // Step 5: Log implied commission as a debit (owner should verify)
    let commissionTxnId = null;
    if (impliedCommission > 0) {
      commissionTxnId = this.db.addTransaction({
        type: 'debit',
        amount: impliedCommission,
        counterparty_name: `${platform} Commission`,
        method: 'PLATFORM',
        source: 'system',
        category: 'platform_commission',
        confidence: 0.80,
        is_confirmed: 0,  // Owner should verify
        transaction_date: new Date().toISOString().split('T')[0]
      });
    }

    return {
      settlementTxnId,
      commissionTxnId,
      ordersReconciled: pendingOrders.length,
      grossAmount: pendingTotal,
      netReceived: settlementAmount,
      estimatedCommission: impliedCommission
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // LOG RETURN — handle platform returns/refunds
  // ════════════════════════════════════════════════════════════════════

  /**
   * Handle a return/refund from a platform.
   * Creates a debit transaction to reverse the original order credit.
   *
   * @param {Object} parsed - Parsed return notification
   * @param {number} parsed.amount - Return/refund amount
   * @param {string} parsed.orderId - Original order ID
   * @param {number} parsed.confidence - Parser confidence score
   * @param {string} platform - Platform name (e.g. 'Amazon')
   * @returns {number} Transaction ID of the return debit
   */
  logReturn(parsed, platform) {
    const txnId = this.db.addTransaction({
      type: 'debit',
      amount: parsed.amount,
      counterparty_name: `${platform} Return #${parsed.orderId}`,
      method: 'PLATFORM',
      source: 'notification',
      category: 'platform_return',
      reference_id: parsed.orderId,
      confidence: parsed.confidence,
      is_confirmed: 0,
      transaction_date: new Date().toISOString().split('T')[0]
    });

    return txnId;
  }

  // ════════════════════════════════════════════════════════════════════
  // PLATFORM SUMMARY — aggregated view for a given platform and period
  // ════════════════════════════════════════════════════════════════════

  /**
   * Get a summary of platform activity over a given number of days.
   *
   * @param {string} platform - Platform name (e.g. 'Swiggy')
   * @param {number} [days=7] - Number of days to look back
   * @returns {{ pending: number, settled: number, commission: number, returns: number, netReceived: number }}
   */
  getPlatformSummary(platform, days = 7) {
    const cutoff = `-${days} days`;

    // Total pending (unconfirmed platform orders)
    const pendingRow = this.db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE category = 'platform_pending'
        AND counterparty_name LIKE ?
        AND is_confirmed = 0 AND is_deleted = 0
        AND transaction_date >= date('now', ?)
    `).get(`${platform}%`, cutoff);

    // Total settled (confirmed platform orders)
    const settledRow = this.db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE category = 'platform_settlement'
        AND counterparty_name LIKE ?
        AND is_deleted = 0
        AND transaction_date >= date('now', ?)
    `).get(`${platform}%`, cutoff);

    // Total commission
    const commissionRow = this.db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE category = 'platform_commission'
        AND counterparty_name LIKE ?
        AND is_deleted = 0
        AND transaction_date >= date('now', ?)
    `).get(`${platform}%`, cutoff);

    // Total returns
    const returnsRow = this.db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE category = 'platform_return'
        AND counterparty_name LIKE ?
        AND is_deleted = 0
        AND transaction_date >= date('now', ?)
    `).get(`${platform}%`, cutoff);

    const pending = pendingRow.total;
    const settled = settledRow.total;
    const commission = commissionRow.total;
    const returns = returnsRow.total;

    return {
      pending,
      settled,
      commission,
      returns,
      netReceived: settled - commission - returns
    };
  }
}

module.exports = { PlatformAccountant, PLATFORM_COMMISSION_RATES };
