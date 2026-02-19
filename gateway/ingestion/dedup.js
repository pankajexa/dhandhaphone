// gateway/ingestion/dedup.js — Cross-channel deduplication engine for DhandhaPhone
// Prevents double-counting when the same transaction arrives via SMS + notification + voice etc.

const crypto = require('crypto');

class DedupEngine {
  /**
   * @param {Object} db - DhandhaDB instance with .db (raw better-sqlite3) and helper methods
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Three-tier deduplication check.
   *
   * Tier 1: Reference ID match (confidence 1.0)
   *   If two transactions share the same UPI/bank reference number,
   *   they are definitively the same transaction.
   *
   * Tier 2: Hash match (confidence 0.95)
   *   SHA256 of (amount + date + reference_id). Stored in dedup_log
   *   by both SMS poller and notification poller. If hash exists, skip.
   *
   * Tier 3: Fuzzy match (confidence 0.80)
   *   Same amount + same type + within 10-minute window, but NOT if
   *   both have counterparty names that differ significantly.
   *
   * @param {Object} parsed - Parsed transaction object
   * @param {number} parsed.amount
   * @param {'credit'|'debit'} parsed.type
   * @param {string|null} parsed.reference_id
   * @param {string|null} parsed.counterparty
   * @param {string|null} parsed.transaction_date - ISO string
   * @param {string} source - Channel source (e.g. 'sms', 'notification', 'voice')
   * @returns {{ isDupe: boolean, tier?: number, matchedTxnId?: number, matchedSource?: string, confidence?: number }}
   */
  isDuplicate(parsed, source) {
    // ── Tier 1: Reference ID match ──────────────────────────────────
    if (parsed.reference_id) {
      const refMatch = this.db.db.prepare(`
        SELECT id, source FROM transactions
        WHERE reference_id = ? AND is_deleted = 0
      `).get(parsed.reference_id);

      if (refMatch) {
        return {
          isDupe: true,
          tier: 1,
          matchedTxnId: refMatch.id,
          matchedSource: refMatch.source,
          confidence: 1.0
        };
      }
    }

    // ── Tier 2: Hash match ──────────────────────────────────────────
    const hash = this.computeHash(parsed);
    const hashMatch = this.db.getDedupByHash(hash);

    if (hashMatch) {
      return {
        isDupe: true,
        tier: 2,
        matchedTxnId: hashMatch.transaction_id,
        matchedSource: hashMatch.source,
        confidence: 0.95
      };
    }

    // ── Tier 3: Fuzzy match ─────────────────────────────────────────
    const windowSeconds = 10 * 60; // 10 minutes
    const txnDate = parsed.transaction_date || new Date().toISOString();

    const fuzzyMatch = this.db.db.prepare(`
      SELECT id, source, counterparty_name FROM transactions
      WHERE amount = ? AND type = ?
        AND source != ?
        AND is_deleted = 0
        AND abs(
          strftime('%s', transaction_date) -
          strftime('%s', ?)
        ) < ?
    `).get(
      parsed.amount, parsed.type, source,
      txnDate, windowSeconds
    );

    if (fuzzyMatch) {
      // If both have counterparty names and they differ, NOT a dupe
      if (parsed.counterparty && fuzzyMatch.counterparty_name) {
        const similarity = this.nameSimilarity(
          parsed.counterparty, fuzzyMatch.counterparty_name
        );
        if (similarity < 0.5) {
          return { isDupe: false };
        }
      }

      return {
        isDupe: true,
        tier: 3,
        matchedTxnId: fuzzyMatch.id,
        matchedSource: fuzzyMatch.source,
        confidence: 0.80
      };
    }

    return { isDupe: false };
  }

  /**
   * Compute SHA256 hash for dedup fingerprinting.
   * Format: amount|YYYY-MM-DD|reference_id
   *
   * @param {Object} parsed
   * @returns {string} hex digest
   */
  computeHash(parsed) {
    const dateStr = (parsed.transaction_date || new Date().toISOString())
      .split('T')[0];
    const raw = `${parsed.amount}|${dateStr}|${parsed.reference_id || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Normalized name similarity score (0.0 to 1.0).
   *
   * - Exact match (case-insensitive) => 1.0
   * - One contains the other => 0.8 (common for UPI names vs contact names,
   *   e.g. "RAJAN KUMAR" contains "rajan")
   * - Otherwise => 1 - (levenshtein_distance / max_length)
   *
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  nameSimilarity(a, b) {
    const aLower = (a || '').toLowerCase().trim();
    const bLower = (b || '').toLowerCase().trim();

    if (aLower === bLower) return 1.0;
    if (!aLower || !bLower) return 0.0;

    // Check if one contains the other
    if (aLower.includes(bLower) || bLower.includes(aLower)) {
      return 0.8;
    }

    // Levenshtein for everything else
    const maxLen = Math.max(aLower.length, bLower.length);
    const distance = this.levenshtein(aLower, bLower);
    return 1 - (distance / maxLen);
  }

  /**
   * Standard Levenshtein distance (edit distance) between two strings.
   * Implemented inline — no external dependencies.
   *
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Use single-row DP for O(min(m,n)) space
    const m = a.length;
    const n = b.length;

    // Ensure we iterate over the shorter string in the inner loop
    if (m > n) return this.levenshtein(b, a);

    let prev = new Array(m + 1);
    let curr = new Array(m + 1);

    // Base case: distance from empty string
    for (let i = 0; i <= m; i++) {
      prev[i] = i;
    }

    for (let j = 1; j <= n; j++) {
      curr[0] = j;
      for (let i = 1; i <= m; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[i] = Math.min(
          curr[i - 1] + 1,      // insertion
          prev[i] + 1,           // deletion
          prev[i - 1] + cost     // substitution
        );
      }
      // Swap rows
      [prev, curr] = [curr, prev];
    }

    return prev[m];
  }

  /**
   * Record a transaction in the dedup_log for future matching.
   * Should be called after successfully inserting a transaction.
   *
   * @param {Object} parsed - The parsed transaction data
   * @param {string} source - Channel source (e.g. 'sms', 'notification')
   * @param {number} transactionId - The DB id of the inserted transaction
   */
  recordTransaction(parsed, source, transactionId) {
    const hash = this.computeHash(parsed);
    this.db.addDedupEntry(hash, source, transactionId);
  }
}

module.exports = { DedupEngine };
