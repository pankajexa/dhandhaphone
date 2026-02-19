// Anomaly Detector — Statistical anomaly detection (no LLM)
// Uses existing config.js thresholds + transaction data

class AnomalyDetector {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  /**
   * Run all anomaly checks, return array of observation objects.
   */
  detectAll() {
    const observations = [];

    observations.push(...this.checkRevenueDeviation());
    observations.push(...this.checkExpenseSpike());
    observations.push(...this.checkRapidFireDebits());
    observations.push(...this.checkNightTransactions());
    observations.push(...this.checkUnusualAmounts());
    observations.push(...this.checkMissingRegulars());

    return observations;
  }

  /**
   * Today's credits vs 7-day average. Anomaly if >50% below.
   */
  checkRevenueDeviation() {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = _daysAgo(7);
    const dropPct = this.config.get('fraud_revenue_drop_pct') || 50;

    try {
      const todayCredits = this.db.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM transactions
        WHERE type = 'credit' AND is_deleted = 0
          AND transaction_date = ?
      `).get(today);

      const weekCredits = this.db.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT transaction_date) as days
        FROM transactions
        WHERE type = 'credit' AND is_deleted = 0
          AND transaction_date >= ? AND transaction_date < ?
      `).get(sevenDaysAgo, today);

      const avgDaily = weekCredits.days > 0 ? weekCredits.total / weekCredits.days : 0;
      if (avgDaily === 0) return [];

      const todayTotal = todayCredits.total;
      const deviation = ((avgDaily - todayTotal) / avgDaily) * 100;

      if (deviation > dropPct) {
        return [{
          type: 'anomaly',
          content: `Revenue today ₹${todayTotal.toLocaleString('en-IN')} is ${deviation.toFixed(0)}% below 7-day avg ₹${Math.round(avgDaily).toLocaleString('en-IN')}`,
          properties: { check: 'revenue_deviation', today_total: todayTotal, avg_daily: avgDaily, deviation_pct: deviation },
          confidence: Math.min(0.9, 0.5 + (deviation - dropPct) / 100),
          source: 'heartbeat'
        }];
      }
    } catch { /* ignore */ }
    return [];
  }

  /**
   * Today's debits vs 7-day average. Anomaly if >2x above.
   */
  checkExpenseSpike() {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = _daysAgo(7);
    const multiplier = this.config.get('fraud_expense_spike_multiplier') || 2;

    try {
      const todayDebits = this.db.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM transactions
        WHERE type = 'debit' AND is_deleted = 0
          AND transaction_date = ?
      `).get(today);

      const weekDebits = this.db.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT transaction_date) as days
        FROM transactions
        WHERE type = 'debit' AND is_deleted = 0
          AND transaction_date >= ? AND transaction_date < ?
      `).get(sevenDaysAgo, today);

      const avgDaily = weekDebits.days > 0 ? weekDebits.total / weekDebits.days : 0;
      if (avgDaily === 0) return [];

      const todayTotal = todayDebits.total;
      if (todayTotal > avgDaily * multiplier) {
        return [{
          type: 'anomaly',
          content: `Expenses today ₹${todayTotal.toLocaleString('en-IN')} are ${(todayTotal / avgDaily).toFixed(1)}x the 7-day avg`,
          properties: { check: 'expense_spike', today_total: todayTotal, avg_daily: avgDaily, multiplier: todayTotal / avgDaily },
          confidence: Math.min(0.9, 0.5 + (todayTotal / avgDaily - multiplier) / 5),
          source: 'heartbeat'
        }];
      }
    } catch { /* ignore */ }
    return [];
  }

  /**
   * N debits within M minutes. Anomaly if exceeded.
   */
  checkRapidFireDebits() {
    const maxCount = this.config.get('fraud_rapid_fire_count') || 5;
    const windowMin = Number(this.config.get('fraud_rapid_fire_window_min')) || 10;

    try {
      // Compute cutoff in JS to avoid SQL string interpolation
      const cutoff = new Date(Date.now() - windowMin * 60 * 1000).toISOString()
        .replace('T', ' ').split('.')[0];
      const recentDebits = this.db.db.prepare(`
        SELECT id, amount, counterparty_name, created_at
        FROM transactions
        WHERE type = 'debit' AND is_deleted = 0
          AND created_at >= ?
        ORDER BY created_at DESC
      `).all(cutoff);

      if (recentDebits.length >= maxCount) {
        const totalAmount = recentDebits.reduce((s, t) => s + t.amount, 0);
        return [{
          type: 'anomaly',
          content: `${recentDebits.length} debits totaling ₹${totalAmount.toLocaleString('en-IN')} in last ${windowMin} minutes`,
          properties: { check: 'rapid_fire', count: recentDebits.length, total: totalAmount, window_min: windowMin },
          confidence: 0.8,
          source: 'heartbeat'
        }];
      }
    } catch { /* ignore */ }
    return [];
  }

  /**
   * Debits during night hours.
   */
  checkNightTransactions() {
    const nightStart = this.config.get('fraud_night_start_hour') || 0;
    const nightEnd = this.config.get('fraud_night_end_hour') || 5;
    const observations = [];

    try {
      // Use +5:30 offset to convert UTC timestamps to IST for night check
      const nightDebits = this.db.db.prepare(`
        SELECT id, amount, counterparty_name, created_at
        FROM transactions
        WHERE type = 'debit' AND is_deleted = 0
          AND transaction_date = date('now')
          AND CAST(strftime('%H', created_at, '+5 hours', '+30 minutes') AS INTEGER) >= ?
          AND CAST(strftime('%H', created_at, '+5 hours', '+30 minutes') AS INTEGER) < ?
      `).all(nightStart, nightEnd);

      for (const txn of nightDebits) {
        observations.push({
          type: 'anomaly',
          content: `Night debit: ₹${txn.amount.toLocaleString('en-IN')} to ${txn.counterparty_name || 'unknown'} at ${txn.created_at}`,
          properties: { check: 'night_transaction', transaction_id: txn.id, amount: txn.amount },
          confidence: 0.6,
          source: 'heartbeat'
        });
      }
    } catch { /* ignore */ }
    return observations;
  }

  /**
   * Amount vs counterparty average. Anomaly if >3x the avg.
   */
  checkUnusualAmounts() {
    const multiplier = this.config.get('fraud_amount_anomaly_multiplier') || 3;
    const observations = [];

    try {
      // Get today's transactions with counterparties
      const todayTxns = this.db.db.prepare(`
        SELECT id, type, amount, counterparty_name, counterparty_id
        FROM transactions
        WHERE is_deleted = 0 AND transaction_date = date('now')
          AND counterparty_name IS NOT NULL
      `).all();

      for (const txn of todayTxns) {
        // Get historical average for this counterparty (same transaction type)
        const hist = this.db.db.prepare(`
          SELECT AVG(amount) as avg_amount, COUNT(*) as cnt
          FROM transactions
          WHERE is_deleted = 0
            AND counterparty_name = ?
            AND type = ?
            AND id != ?
        `).get(txn.counterparty_name, txn.type, txn.id);

        if (hist && hist.cnt >= 3 && txn.amount > hist.avg_amount * multiplier) {
          observations.push({
            type: 'anomaly',
            content: `Unusual ₹${txn.amount.toLocaleString('en-IN')} ${txn.type} with ${txn.counterparty_name} (avg: ₹${hist.avg_amount.toFixed(0)})`,
            properties: { check: 'unusual_amount', transaction_id: txn.id, amount: txn.amount, avg: hist.avg_amount, ratio: txn.amount / hist.avg_amount },
            confidence: 0.7,
            source: 'heartbeat'
          });
        }
      }
    } catch { /* ignore */ }
    return observations;
  }

  /**
   * Regular contacts who haven't transacted recently.
   * Uses brain_entities with avg_gap_days. Insight if 2x overdue.
   */
  checkMissingRegulars() {
    const observations = [];

    try {
      const profiles = this.db.getBrainEntitiesByType('customer_profile', { activeOnly: true });

      for (const profile of profiles) {
        const avgGap = profile.properties.avg_gap_days;
        if (!avgGap || avgGap <= 0) continue;

        // Get last transaction date for this contact
        const lastTxn = this.db.db.prepare(`
          SELECT MAX(transaction_date) as last_date
          FROM transactions
          WHERE is_deleted = 0 AND counterparty_id = ?
        `).get(profile.ref_id);

        if (!lastTxn || !lastTxn.last_date) continue;

        const daysSince = Math.floor(
          (Date.now() - new Date(lastTxn.last_date).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSince > avgGap * 2) {
          observations.push({
            type: 'insight',
            entity_id: profile.id,
            content: `${profile.name.replace(' Profile', '')} hasn't transacted in ${daysSince} days (usually every ${avgGap} days)`,
            properties: { check: 'missing_regular', days_since: daysSince, avg_gap: avgGap, contact_id: profile.ref_id },
            confidence: 0.6,
            source: 'analysis'
          });
        }
      }
    } catch { /* ignore */ }
    return observations;
  }
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

module.exports = { AnomalyDetector };
