// Brain Context Loader — Three-tier context assembly for the agent
// Follows the onboarding-gate.js pattern: returns { contextBlock: string|null }

const path = require('path');
const fs = require('fs');

// Topic map for Tier 3 knowledge lookup
// Sorted longest-first so more specific keywords match before generic ones
const TOPIC_MAP_RAW = {
  'input credit': 'gst/input-credit.md',
  'gst filing': 'gst/gstr-filing.md',
  'gst rate': 'gst/rates-goods.md',
  'shelf life': 'inventory/shelf-life.md',
  composition: 'gst/composition-scheme.md',
  elasticity: 'pricing/price-elasticity-basics.md',
  navratri: 'indian-business/festival-calendar.md',
  regional: 'indian-business/regional-customs.md',
  festival: 'indian-business/festival-calendar.md',
  monsoon: 'indian-business/seasonal-patterns.md',
  harvest: 'indian-business/seasonal-patterns.md',
  reorder: 'inventory/reorder-logic.md',
  udhaar: 'indian-business/credit-culture.md',
  diwali: 'indian-business/festival-calendar.md',
  pongal: 'indian-business/festival-calendar.md',
  season: 'indian-business/seasonal-patterns.md',
  margin: 'pricing/margin-analysis.md',
  markup: 'pricing/margin-analysis.md',
  pricing: 'pricing/_overview.md',
  expiry: 'inventory/shelf-life.md',
  udhar: 'indian-business/credit-culture.md',
  onam: 'indian-business/festival-calendar.md',
  gstr: 'gst/gstr-filing.md',
  fifo: 'inventory/fifo-basics.md',
  gst: 'gst/_overview.md',
  itc: 'gst/input-credit.md',
};
// Build sorted array: longest keywords first for priority matching
const TOPIC_ENTRIES = Object.entries(TOPIC_MAP_RAW)
  .sort((a, b) => b[0].length - a[0].length);

class ContextLoader {
  constructor(db) {
    this.db = db;
    this._snapshotCache = null;
    this._snapshotCacheTime = 0;
    this._snapshotCacheTTL = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Main entry: assemble context block for the agent.
   * @param {string} message - The owner's current message
   * @param {object} opts - { knowledgePath? }
   * @returns {{ contextBlock: string|null }}
   */
  getContextBlock(message, opts = {}) {
    const parts = [];

    // Tier 1: Always-on snapshot + observations + patterns
    const snapshot = this._getBusinessSnapshot();
    if (snapshot) parts.push(snapshot);

    const observations = this._getTopObservations(5);
    if (observations) parts.push(observations);

    const patterns = this._getTopPatterns(3);
    if (patterns) parts.push(patterns);

    // Tier 2: Entity context for mentioned contacts
    const entityContext = this._getEntityContext(message);
    if (entityContext) parts.push(entityContext);

    // Tier 3: Relevant knowledge files
    const knowledge = this._getRelevantKnowledge(message, opts.knowledgePath);
    if (knowledge) parts.push(knowledge);

    if (parts.length === 0) return { contextBlock: null };

    const block = `<business-brain>\n${parts.join('\n\n')}\n</business-brain>`;
    return { contextBlock: block };
  }

  _getBusinessSnapshot() {
    const now = Date.now();
    if (this._snapshotCache && (now - this._snapshotCacheTime) < this._snapshotCacheTTL) {
      return this._snapshotCache;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const summary = this.db.getDailySummary(today);

      let revenue = 0, expenses = 0, txnCount = 0;
      for (const row of summary) {
        txnCount += row.count;
        if (row.type === 'credit') revenue += row.total;
        if (row.type === 'debit') expenses += row.total;
      }

      const result = `## Today's Snapshot (${today})\nRevenue: ₹${revenue.toLocaleString('en-IN')} | Expenses: ₹${expenses.toLocaleString('en-IN')} | Transactions: ${txnCount}`;
      this._snapshotCache = result;
      this._snapshotCacheTime = now;
      return result;
    } catch {
      return null;
    }
  }

  _getTopObservations(limit) {
    try {
      const obs = this.db.getActiveObservations({ limit, minConfidence: 0.4 });
      if (obs.length === 0) return null;

      const lines = obs.map(o => {
        const icon = { anomaly: '!', intention: '?', prediction: '~', insight: '*', todo: '-' }[o.type] || '-';
        return `  ${icon} [${o.type}] ${o.content} (confidence: ${o.confidence})`;
      });
      return `## Active Observations\n${lines.join('\n')}`;
    } catch {
      return null;
    }
  }

  _getTopPatterns(limit) {
    try {
      const patterns = this.db.getBrainEntitiesByType('pattern', {
        limit, minConfidence: 0.6, activeOnly: true
      });
      if (patterns.length === 0) return null;

      const lines = patterns.map(p => `  - ${p.name}: ${JSON.stringify(p.properties)}`);
      return `## Known Patterns\n${lines.join('\n')}`;
    } catch {
      return null;
    }
  }

  _getEntityContext(message) {
    if (!message) return null;

    try {
      // Get all contact names for matching
      const contacts = this.db.db.prepare(
        "SELECT id, name, name_normalized FROM contacts WHERE is_deleted = 0 AND name_normalized IS NOT NULL"
      ).all();

      const msgLower = message.toLowerCase();
      const matched = [];

      for (const contact of contacts) {
        // Match if any word in the contact name (3+ chars) appears as a whole word in message
        const words = (contact.name_normalized || '').split(/\s+/).filter(w => w.length >= 3);
        for (const word of words) {
          // Escape regex special chars, then do word-boundary match
          const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}\\b`).test(msgLower)) {
            matched.push(contact);
            break;
          }
        }
        if (matched.length >= 3) break;
      }

      if (matched.length === 0) return null;

      const parts = [];
      for (const contact of matched) {
        const entity = this.db.findBrainEntityByRef('contacts', contact.id);
        if (!entity) continue;

        const ctx = this.db.getBrainEntityContext(entity.id);
        if (!ctx) continue;

        const lines = [`### ${contact.name}`];

        // Properties
        const props = ctx.entity.properties;
        if (props && Object.keys(props).length > 0) {
          const propStrs = [];
          if (props.avg_order) propStrs.push(`Avg order: ₹${props.avg_order.toLocaleString('en-IN')}`);
          if (props.payment_day) propStrs.push(`Usually pays: ${props.payment_day}th`);
          if (props.reliability != null) propStrs.push(`Reliability: ${(props.reliability * 100).toFixed(0)}%`);
          if (props.trend) propStrs.push(`Trend: ${props.trend}`);
          if (props.avg_gap_days) propStrs.push(`Avg gap: ${props.avg_gap_days}d`);
          if (propStrs.length > 0) lines.push(`  ${propStrs.join(' | ')}`);
        }

        // Edges
        if (ctx.edges.length > 0) {
          const edgeStrs = ctx.edges.slice(0, 3).map(e =>
            `${e.type} → ${e.target_name || '?'} (w:${e.weight})`
          );
          lines.push(`  Relations: ${edgeStrs.join(', ')}`);
        }

        // Observations
        if (ctx.observations.length > 0) {
          const obsStrs = ctx.observations.slice(0, 3).map(o =>
            `[${o.type}] ${o.content}`
          );
          lines.push(`  Notes: ${obsStrs.join('; ')}`);
        }

        parts.push(lines.join('\n'));
      }

      if (parts.length === 0) return null;
      return `## Contact Intelligence\n${parts.join('\n')}`;
    } catch {
      return null;
    }
  }

  _getRelevantKnowledge(message, knowledgePath) {
    if (!message) return null;

    const basePath = knowledgePath || path.join(
      process.env.DHANDHA_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace'),
      'knowledge'
    );

    const msgLower = message.toLowerCase();
    let matchedFile = null;

    for (const [keyword, filePath] of TOPIC_ENTRIES) {
      // Use word boundary check for single words, includes for multi-word
      if (keyword.includes(' ') ? msgLower.includes(keyword) : new RegExp(`\\b${keyword}\\b`).test(msgLower)) {
        matchedFile = filePath;
        break;
      }
    }

    if (!matchedFile) return null;

    try {
      const fullPath = path.join(basePath, matchedFile);
      if (!fs.existsSync(fullPath)) return null;
      const content = fs.readFileSync(fullPath, 'utf8').trim();
      if (!content) return null;
      // Cap at ~1000 tokens (~4000 chars)
      const capped = content.length > 4000 ? content.slice(0, 4000) + '\n...(truncated)' : content;
      return `## Reference: ${matchedFile}\n${capped}`;
    } catch {
      return null;
    }
  }
}

/**
 * Convenience function following onboarding-gate.js pattern.
 */
function getBrainContext(message, opts = {}) {
  const { getDB } = require('../utils');
  const db = getDB();
  const loader = new ContextLoader(db);
  return loader.getContextBlock(message, opts);
}

module.exports = { ContextLoader, getBrainContext };
