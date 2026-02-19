// Pattern Detector — Computes entity statistics from transaction data (no LLM)
// Detects rhythms, trends, and broken patterns

const { GraphUpdater } = require('./graph-updater');

class PatternDetector {
  constructor(db) {
    this.db = db;
    this.updater = new GraphUpdater(db);
  }

  /**
   * Orchestrate all refresh operations.
   */
  refreshAll() {
    const results = {
      contacts_refreshed: 0,
      snapshot_updated: false,
      broken_rhythms: 0,
    };

    results.contacts_refreshed = this.refreshContactStats();
    results.snapshot_updated = this.refreshBusinessSnapshot();
    results.broken_rhythms = this.detectBrokenRhythms();

    return results;
  }

  /**
   * For each contact with 3+ transactions, compute stats and upsert profile.
   */
  refreshContactStats() {
    let count = 0;

    try {
      // Get contacts with enough transaction history
      const contacts = this.db.db.prepare(`
        SELECT
          counterparty_id,
          counterparty_name,
          COUNT(*) as txn_count,
          AVG(amount) as avg_amount,
          SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_credit,
          SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_debit
        FROM transactions
        WHERE is_deleted = 0
          AND counterparty_id IS NOT NULL
        GROUP BY counterparty_id
        HAVING txn_count >= 3
      `).all();

      for (const c of contacts) {
        // Compute payment day (mode of day-of-month)
        const dayRows = this.db.db.prepare(`
          SELECT CAST(strftime('%d', transaction_date) AS INTEGER) as dom,
                 COUNT(*) as cnt
          FROM transactions
          WHERE is_deleted = 0 AND counterparty_id = ?
          GROUP BY dom
          ORDER BY cnt DESC
          LIMIT 1
        `).get(c.counterparty_id);

        const paymentDay = dayRows ? dayRows.dom : null;

        // Compute avg gap days between transactions
        const dates = this.db.db.prepare(`
          SELECT transaction_date
          FROM transactions
          WHERE is_deleted = 0 AND counterparty_id = ?
          ORDER BY transaction_date ASC
        `).all(c.counterparty_id).map(r => r.transaction_date);

        let avgGapDays = null;
        if (dates.length >= 2) {
          let totalGap = 0;
          for (let i = 1; i < dates.length; i++) {
            const gap = (new Date(dates[i]) - new Date(dates[i - 1])) / (1000 * 60 * 60 * 24);
            totalGap += gap;
          }
          avgGapDays = Math.round(totalGap / (dates.length - 1));
        }

        // Compute trend: compare recent 3 txn avg vs older 3 txn avg
        let trend = 'stable';
        if (dates.length >= 6) {
          const recentAmounts = this.db.db.prepare(`
            SELECT AVG(amount) as avg
            FROM (
              SELECT amount FROM transactions
              WHERE is_deleted = 0 AND counterparty_id = ?
              ORDER BY transaction_date DESC
              LIMIT 3
            )
          `).get(c.counterparty_id);

          const olderAmounts = this.db.db.prepare(`
            SELECT AVG(amount) as avg
            FROM (
              SELECT amount FROM transactions
              WHERE is_deleted = 0 AND counterparty_id = ?
              ORDER BY transaction_date DESC
              LIMIT 3 OFFSET 3
            )
          `).get(c.counterparty_id);

          if (recentAmounts && olderAmounts && olderAmounts.avg > 0) {
            const change = (recentAmounts.avg - olderAmounts.avg) / olderAmounts.avg;
            if (change > 0.15) trend = 'growing';
            else if (change < -0.15) trend = 'declining';
          }
        }

        const profileData = {
          avg_order: Math.round(c.avg_amount),
          txn_count: c.txn_count,
          total_credit: c.total_credit,
          total_debit: c.total_debit,
          payment_day: paymentDay,
          avg_gap_days: avgGapDays,
          trend,
          last_refreshed: new Date().toISOString(),
        };

        this.updater.upsertContactProfile(c.counterparty_id, profileData);
        count++;
      }
    } catch { /* ignore */ }

    return count;
  }

  /**
   * Compute 7-day rolling averages and receivable totals. Update snapshot entity.
   */
  refreshBusinessSnapshot() {
    try {
      const sevenDaysAgo = _daysAgo(7);
      const today = new Date().toISOString().split('T')[0];

      const weekStats = this.db.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_expenses,
          COUNT(*) as txn_count,
          COUNT(DISTINCT transaction_date) as active_days
        FROM transactions
        WHERE is_deleted = 0
          AND transaction_date >= ?
      `).get(sevenDaysAgo);

      const activeDays = Math.max(weekStats.active_days, 1);
      const dailyAvgRevenue = Math.round(weekStats.total_revenue / activeDays);
      const dailyAvgExpenses = Math.round(weekStats.total_expenses / activeDays);

      // Get total receivables
      const receivables = this.db.db.prepare(`
        SELECT COALESCE(SUM(balance), 0) as total
        FROM contacts
        WHERE is_deleted = 0 AND balance > 0
      `).get();

      // Get total payables
      const payables = this.db.db.prepare(`
        SELECT COALESCE(ABS(SUM(balance)), 0) as total
        FROM contacts
        WHERE is_deleted = 0 AND balance < 0
      `).get();

      this.updater.updateBusinessSnapshot({
        daily_avg_revenue: dailyAvgRevenue,
        daily_avg_expenses: dailyAvgExpenses,
        weekly_txn_count: weekStats.txn_count,
        total_receivables: receivables.total,
        total_payables: payables.total,
        last_refreshed: today,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * For entities with avg_gap_days, detect if current gap > 2x average.
   */
  detectBrokenRhythms() {
    let count = 0;

    try {
      const profiles = this.db.getBrainEntitiesByType('customer_profile', { activeOnly: true });

      for (const profile of profiles) {
        const avgGap = profile.properties.avg_gap_days;
        if (!avgGap || avgGap <= 0 || !profile.ref_id) continue;

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
          // Check if we already have a recent observation for this
          const existing = this.db.getActiveObservations({
            type: 'insight',
            entity_id: profile.id,
            limit: 5
          });

          const alreadyNoted = existing.some(o =>
            o.properties && (o.properties.check === 'broken_rhythm' || o.properties.check === 'missing_regular')
          );

          if (!alreadyNoted) {
            this.updater.addObservation({
              type: 'insight',
              entity_id: profile.id,
              content: `${profile.name.replace(' Profile', '')} hasn't transacted in ${daysSince} days (usually every ${avgGap} days)`,
              properties: { check: 'broken_rhythm', days_since: daysSince, avg_gap: avgGap },
              confidence: 0.6,
              source: 'analysis'
            });
            count++;
          }
        }
      }
    } catch { /* ignore */ }

    return count;
  }
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

module.exports = { PatternDetector };
