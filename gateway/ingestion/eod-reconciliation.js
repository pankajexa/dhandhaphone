// gateway/ingestion/eod-reconciliation.js — End-of-Day Reconciliation for DhandhaPhone
// At closing time, sends the owner a daily summary and processes their response:
//   Mode A: "Sahi hai" / "Correct" — close the day
//   Mode B: "Total 45,000 tha aaj" — identify the gap and ask about it
//   Mode C: Detailed corrections — acknowledge and hand off to correction pipeline
//   Default: Treat as dictation of missed transactions

'use strict';

// ────────────────────────────────────────────────────────────────
// EOD TEMPLATES — daily summary in all 11 supported languages
// Placeholders: {credit_total}, {debit_total}, {net}, {txn_count}
// ────────────────────────────────────────────────────────────────
const EOD_TEMPLATES = {
  en: "Today's count: \u20B9{credit_total} in, \u20B9{debit_total} out. Net \u20B9{net}. Correct? Anything else today?",
  hi: "Aaj ka hisab: \u20B9{credit_total} aaya, \u20B9{debit_total} gaya. Net \u20B9{net}. Sahi hai? Ya kuch aur hua aaj?",
  te: "Ee roju lekkhalu: \u20B9{credit_total} vachindi, \u20B9{debit_total} vellindi. Net \u20B9{net}. Correct aa? Inkemaina jarigindaa?",
  ta: "Innaiku kanakku: \u20B9{credit_total} vanthuchu, \u20B9{debit_total} pochchu. Net \u20B9{net}. Sari-yaa? Vera enna nadanthuchu?",
  kn: "Ivattu lekka: \u20B9{credit_total} bantu, \u20B9{debit_total} hoytu. Net \u20B9{net}. Sari-yaa? Bere enu aaytu?",
  bn: "Ajker hishab: \u20B9{credit_total} eshechhe, \u20B9{debit_total} gechhe. Net \u20B9{net}. Thik achhe? Ar kichu hoyechhe?",
  gu: "Aajno hisab: \u20B9{credit_total} aavya, \u20B9{debit_total} gaya. Net \u20B9{net}. Barabar chhe? Biju kai thayu?",
  mr: "Aajcha hishob: \u20B9{credit_total} aala, \u20B9{debit_total} gela. Net \u20B9{net}. Barobar aahe? Ajun kai zala?",
  ml: "Innalethe kanakku: \u20B9{credit_total} vannu, \u20B9{debit_total} poyi. Net \u20B9{net}. Sheri aano? Veere enthenkkilum undaayo?",
  or: "Aaji hisab: \u20B9{credit_total} asila, \u20B9{debit_total} gala. Net \u20B9{net}. Thik achhi? Aau kichhi hela?",
  pa: "Ajj da hisab: \u20B9{credit_total} aaya, \u20B9{debit_total} gaya. Net \u20B9{net}. Theek hai? Hor kuch hoya?",
};

// ────────────────────────────────────────────────────────────────
// CLOSED MESSAGES — day confirmed, books closed
// ────────────────────────────────────────────────────────────────
const CLOSED_MESSAGES = {
  en: "Today's books closed. See you tomorrow!",
  hi: "Aaj ka hisab band. Kal milte hain!",
  te: "Ee roju lekkhalu muyyaayindi. Repu kaluddam!",
  ta: "Innaiku kanakku mudichu. Naalaikku paakalaam!",
  kn: "Ivattu lekka mugiyitu. Naale sigona!",
  bn: "Ajker hishab bondho. Kaal dekha hobe!",
  gu: "Aajno hisab band. Kaale malishu!",
  mr: "Aajcha hishob band. Udya bhetuya!",
  ml: "Innalethe kanakku adachu. Naalae kaanaam!",
  or: "Aaji hisab bandha. Kaali bhetiba!",
  pa: "Ajj da hisab band. Kal milange!",
};

// ────────────────────────────────────────────────────────────────
// GAP MESSAGES — owner's total differs from captured total
// Placeholder: {gap}
// ────────────────────────────────────────────────────────────────
const GAP_MESSAGES = {
  en: "There's a \u20B9{gap} gap. Any cash transactions that were missed?",
  hi: "\u20B9{gap} ka gap hai. Cash mein kuch hua jo miss ho gaya?",
  te: "\u20B9{gap} difference undi. Cash lo emaina miss ayyindaa?",
  ta: "\u20B9{gap} vithyaasam irukku. Cash la ethaavathu miss aachaa?",
  kn: "\u20B9{gap} gap ide. Cash alli enu miss aaytu?",
  bn: "\u20B9{gap} er gap achhe. Cash e kichhu miss hoyechhe?",
  gu: "\u20B9{gap} no gap chhe. Cash ma koi miss thayu?",
  mr: "\u20B9{gap} cha gap aahe. Cash madhye kahi miss zala?",
  ml: "\u20B9{gap} gap undu. Cash il enthenkkilum miss aayo?",
  or: "\u20B9{gap} gap achhi. Cash re kichhi miss hela?",
  pa: "\u20B9{gap} da gap hai. Cash vich kuch miss ho gaya?",
};

// ────────────────────────────────────────────────────────────────
// CORRECTIONS ACK MESSAGES — owner listed corrections, processing
// ────────────────────────────────────────────────────────────────
const CORRECTIONS_ACK_MESSAGES = {
  en: "Got it. Processing corrections.",
  hi: "Samajh gaya. Corrections kar raha hoon.",
  te: "Arthamayindi. Corrections chestunna.",
  ta: "Purinjuchu. Corrections panren.",
  kn: "Gotthaytu. Corrections maadthaidini.",
  bn: "Bujhechhi. Corrections korchi.",
  gu: "Samjhayo. Corrections kari raho chhu.",
  mr: "Samjhala. Corrections karto aahe.",
  ml: "Manassilayi. Corrections cheyyunnu.",
  or: "Bujhili. Corrections karuchhi.",
  pa: "Samajh gaya. Corrections kar raha haan.",
};

// ────────────────────────────────────────────────────────────────
// Confirmation phrases across all 11 supported languages
// ────────────────────────────────────────────────────────────────
const CONFIRM_PHRASES = [
  'sahi hai', 'correct', 'haan', 'ha', 'theek hai', 'ok',
  'sari', 'correct aa', 'ayyindi', 'aamam', 'howdu',
  'hya', 'achha', 'thik ache', 'bari', 'hau',
];

// Regex for total override across languages:
// "total tha 45000", "total hai ₹45,000", "total was 32500", etc.
const TOTAL_OVERRIDE_RE = /total\s*(?:tha|hai|aaj|was|undi|irundhuchu)?\s*₹?\s*([\d,]+)/i;

// Keywords indicating cancel / correction intent
const CORRECTION_RE = /cancel|hatao|nahi hua|miss|galat|wrong|thappu/;


class EODReconciliation {
  /**
   * @param {Object} db - DhandhaDB instance (has .db property for raw better-sqlite3 access)
   */
  constructor(db) {
    this.db = db;
  }

  // ──────────────────────────────────────────────────────────────
  // generateSummary — build the daily summary text for the owner
  // ──────────────────────────────────────────────────────────────

  /**
   * Query the transactions table for a given date and produce a
   * multilingual summary string plus numeric totals.
   *
   * @param {string} date - YYYY-MM-DD format
   * @param {string} language - ISO language code (en, hi, te, ta, kn, bn, gu, mr, ml, or, pa)
   * @returns {{ text: string, totalCredit: number, totalDebit: number, net: number, txnCount: number }}
   */
  generateSummary(date, language) {
    const lang = (language || 'en').toLowerCase();

    // Aggregate credits and debits for the day
    const rows = this.db.db.prepare(`
      SELECT
        type,
        COALESCE(SUM(amount), 0) AS total,
        COUNT(*) AS count
      FROM transactions
      WHERE transaction_date = ? AND is_deleted = 0
      GROUP BY type
    `).all(date);

    let totalCredit = 0;
    let totalDebit = 0;
    let txnCount = 0;

    for (const row of rows) {
      if (row.type === 'credit') {
        totalCredit = row.total;
        txnCount += row.count;
      } else if (row.type === 'debit') {
        totalDebit = row.total;
        txnCount += row.count;
      }
    }

    const net = totalCredit - totalDebit;

    const template = EOD_TEMPLATES[lang] || EOD_TEMPLATES.en;
    const text = template
      .replace('{credit_total}', formatIndianNumber(totalCredit))
      .replace('{debit_total}', formatIndianNumber(totalDebit))
      .replace('{net}', formatIndianNumber(net));

    return { text, totalCredit, totalDebit, net, txnCount };
  }

  // ──────────────────────────────────────────────────────────────
  // processReconciliation — handle the owner's response
  // ──────────────────────────────────────────────────────────────

  /**
   * Parse the owner's reply and determine the next action.
   *
   * @param {string} ownerResponse - Raw text from the owner
   * @param {string} date - YYYY-MM-DD of the day being reconciled
   * @param {string} language - Language code for reply messages
   * @returns {{ action: string, gap?: number, corrections?: string, message: string|null }}
   */
  processReconciliation(ownerResponse, date, language) {
    const lang = (language || 'en').toLowerCase();
    const intent = this.classifyResponse(ownerResponse);

    switch (intent.type) {
      case 'confirmed':
        return {
          action: 'closed',
          message: getClosedMessage(lang),
        };

      case 'different_total': {
        // Compute what we captured for credits today
        const summary = this.db.db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM transactions
          WHERE transaction_date = ? AND type = 'credit' AND is_deleted = 0
        `).get(date);

        const capturedCredit = summary.total;
        const gap = intent.amount - capturedCredit;

        return {
          action: 'gap_found',
          gap,
          message: getGapMessage(gap, lang),
        };
      }

      case 'corrections':
        return {
          action: 'corrections',
          corrections: intent.corrections,
          message: getCorrectionsAckMessage(lang),
        };

      case 'additional':
      default:
        // Owner is dictating missed transactions — let the normal
        // voice/text processing pipeline handle the content.
        return {
          action: 'additional',
          message: null,
        };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // classifyResponse — multilingual intent classification
  // ──────────────────────────────────────────────────────────────

  /**
   * Classify the owner's reply into one of four intents:
   *   confirmed        — "sahi hai", "correct", "ok", etc.
   *   different_total  — "total tha 45000", "total was ₹32,500"
   *   corrections      — "cancel karo", "galat", "miss hua"
   *   additional       — anything else (treat as missed txn dictation)
   *
   * Order matters: total override and corrections are checked first because
   * short confirmation words ("ha", "ok") can appear as substrings in
   * longer utterances that carry a different intent.
   *
   * @param {string} text - Owner's raw reply
   * @returns {{ type: string, amount?: number, corrections?: string }}
   */
  classifyResponse(text) {
    const lower = (text || '').toLowerCase().trim();

    // 1. Check for total override first — "total tha 45000", "total was ₹32,500"
    //    Must come before confirmation check because "total hai 12000" contains "hai"
    const totalMatch = text.match(TOTAL_OVERRIDE_RE);
    if (totalMatch) {
      const amount = parseFloat(totalMatch[1].replace(/,/g, ''));
      return { type: 'different_total', amount };
    }

    // 2. Check for cancel / correction keywords — "miss hua", "galat hai", "cancel karo"
    //    Must come before confirmation because "galat hai" contains "hai"
    if (CORRECTION_RE.test(lower)) {
      return { type: 'corrections', corrections: text };
    }

    // 3. Check for confirmation phrases across all 11 languages
    //    Use word-boundary matching to avoid false positives on short words
    if (CONFIRM_PHRASES.some(phrase => matchPhrase(lower, phrase))) {
      return { type: 'confirmed' };
    }

    // 4. Default: treat as additional transaction dictation
    return { type: 'additional' };
  }
}

// ────────────────────────────────────────────────────────────────
// Helper: word-boundary-aware phrase matching
// ────────────────────────────────────────────────────────────────

/**
 * Check if a phrase appears in text with word boundaries on both sides.
 * This prevents "ha" from matching inside "tha" or "galat hai" from
 * being treated as confirmation just because it contains "ha".
 *
 * Multi-word phrases (e.g. "sahi hai", "thik ache") are matched with
 * includes() since they are specific enough to avoid false positives.
 * Single short words ("ha", "ok", "hya") use regex word boundaries.
 *
 * @param {string} text - Lowercased input text
 * @param {string} phrase - Confirmation phrase to look for
 * @returns {boolean}
 */
function matchPhrase(text, phrase) {
  // Multi-word phrases are specific enough — substring match is safe
  if (phrase.includes(' ')) {
    return text.includes(phrase);
  }
  // Single words: require word boundaries to avoid partial matches
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s|[,;.!?])${escaped}(?:$|\\s|[,;.!?])`, 'i').test(text);
}

// ────────────────────────────────────────────────────────────────
// Helper: Indian number formatting (12,34,567)
// ────────────────────────────────────────────────────────────────

/**
 * Format a number with Indian-style comma grouping.
 * The last 3 digits form one group, then groups of 2 from the left.
 * Examples: 1234 → "1,234", 1234567 → "12,34,567", 100 → "100"
 *
 * @param {number} num - Number to format
 * @returns {string} Formatted string
 */
function formatIndianNumber(num) {
  if (num == null || isNaN(num)) return '0';

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Split integer and decimal parts
  const parts = absNum.toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];

  // Indian grouping: last 3 digits, then groups of 2
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);

    // Insert commas every 2 digits from right in the remaining part
    const groups = [];
    while (remaining.length > 2) {
      groups.unshift(remaining.slice(-2));
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      groups.unshift(remaining);
    }

    intPart = groups.join(',') + ',' + last3;
  }

  // Drop decimal if it's .00
  const formatted = decPart === '00' ? intPart : `${intPart}.${decPart}`;
  return isNegative ? `-${formatted}` : formatted;
}

// ────────────────────────────────────────────────────────────────
// Message helpers — retrieve localized messages
// ────────────────────────────────────────────────────────────────

/**
 * @param {string} lang - Language code
 * @returns {string} Localized "books closed" message
 */
function getClosedMessage(lang) {
  return CLOSED_MESSAGES[lang] || CLOSED_MESSAGES.en;
}

/**
 * @param {number} gap - Amount difference between owner's total and captured total
 * @param {string} lang - Language code
 * @returns {string} Localized gap message with amount filled in
 */
function getGapMessage(gap, lang) {
  const template = GAP_MESSAGES[lang] || GAP_MESSAGES.en;
  return template.replace('{gap}', formatIndianNumber(Math.abs(gap)));
}

/**
 * @param {string} lang - Language code
 * @returns {string} Localized corrections acknowledgement
 */
function getCorrectionsAckMessage(lang) {
  return CORRECTIONS_ACK_MESSAGES[lang] || CORRECTIONS_ACK_MESSAGES.en;
}

// ────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────
module.exports = {
  EODReconciliation,
  EOD_TEMPLATES,
  formatIndianNumber,
  getClosedMessage,
  getGapMessage,
  getCorrectionsAckMessage,
};
