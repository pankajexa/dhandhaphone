// Document type classifier — keyword-based, no LLM required
// Classifies Sarvam Vision output into business document categories

class DocClassifier {
  /**
   * Classify document type from Sarvam Vision output.
   * Uses keyword matching + structural analysis.
   * Fast local classification — no API call.
   *
   * @param {Object} extracted - Sarvam Vision output { text, tables, metadata }
   * @param {string} [captionHint] - Optional caption from Telegram message
   * @returns {string} Document type
   */
  classify(extracted, captionHint) {
    // If owner provided a caption hint, use it first
    if (captionHint) {
      const hintType = this._classifyFromCaption(captionHint);
      if (hintType) return hintType;
    }

    // Check if Sarvam flagged it as handwritten
    if (extracted.metadata && extracted.metadata.is_handwritten) {
      return 'handwritten_note';
    }

    const text = (extracted.text || extracted.content || '').toLowerCase();
    const hasTables = extracted.tables && extracted.tables.length > 0;

    // Score each category
    const scores = {
      invoice: this._score(text, INVOICE_KEYWORDS),
      receipt: this._score(text, RECEIPT_KEYWORDS),
      business_card: this._score(text, CARD_KEYWORDS) + (text.length < 500 ? 2 : 0),
      bank_statement: this._score(text, BANK_KEYWORDS) + (hasTables ? 2 : 0),
      price_list: this._score(text, PRICE_LIST_KEYWORDS) + (hasTables ? 1 : 0),
      stock_register: this._score(text, STOCK_KEYWORDS),
      handwritten_note: 0,
    };

    // Return highest scoring type, or 'unknown' if all scores are 0
    const best = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'unknown';
  }

  /**
   * Classify from owner's caption text
   * @returns {string|null} Type if detected, null otherwise
   */
  _classifyFromCaption(caption) {
    const hint = caption.toLowerCase();

    if (hint.match(/bill|invoice|supplier|khareed|kharid|purchase|challan/)) return 'invoice';
    if (hint.match(/receipt|payment|raseed|rasid|received/)) return 'receipt';
    if (hint.match(/card|visiting|business card/)) return 'business_card';
    if (hint.match(/bank|statement|passbook/)) return 'bank_statement';
    if (hint.match(/price|rate|list|rate card/)) return 'price_list';
    if (hint.match(/stock|inventory|maal|godown/)) return 'stock_register';
    if (hint.match(/note|handwritten|diary|hisab/)) return 'handwritten_note';

    return null;
  }

  /**
   * Count how many keywords match in the text
   */
  _score(text, keywords) {
    return keywords.filter(kw => text.includes(kw)).length;
  }
}

// ─────────────────────────────────────────────────────────────
//  Keyword lists (multilingual)
// ─────────────────────────────────────────────────────────────

const INVOICE_KEYWORDS = [
  // English
  'invoice', 'bill', 'tax invoice', 'gst',
  'gstin', 'hsn', 'sac', 'cgst', 'sgst', 'igst',
  'bill no', 'invoice no', 'challan',
  // Hindi
  '\u092C\u093F\u0932', '\u091A\u093E\u0932\u093E\u0928',
  '\u0915\u0930 \u092C\u0940\u091C\u0915',
  // Telugu
  '\u0C2C\u0C3F\u0C32\u0C4D\u0C32\u0C41',
  '\u0C07\u0C28\u0C4D\u0C35\u0C3E\u0C2F\u0C3F\u0C38\u0C4D',
  // Tamil
  '\u0BAA\u0BBF\u0BB2\u0BCD',
  '\u0BB5\u0BBF\u0BB2\u0BC8\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BBF\u0BAF\u0BB2\u0BCD',
  // Kannada
  '\u0CAC\u0CBF\u0CB2\u0CCD',
  // Bengali
  '\u09AC\u09BF\u09B2',
  // Marathi
  '\u092C\u093F\u0932',
  // Gujarati
  '\u0AAC\u0ABF\u0AB2',
];

const RECEIPT_KEYWORDS = [
  'receipt', 'received with thanks', 'payment received',
  'cash memo', 'cash receipt', 'raseed',
  // Hindi
  '\u0930\u0938\u0940\u0926', '\u092A\u094D\u0930\u093E\u092A\u094D\u0924\u093F',
  // Telugu
  '\u0C30\u0C38\u0C40\u0C26\u0C41',
  // Tamil
  '\u0BB0\u0B9A\u0BC0\u0BA4\u0BC1',
];

const CARD_KEYWORDS = [
  'mobile', 'email', 'tel', 'fax', 'www.',
  '@', '.com', '.in', 'director', 'proprietor',
  'manager', 'owner', 'ceo', 'founder',
  'ph:', 'phone:', 'mob:',
];

const BANK_KEYWORDS = [
  'statement of account', 'bank statement',
  'opening balance', 'closing balance',
  'transaction history', 'account summary',
  'ifsc', 'account no', 'a/c no',
];

const PRICE_LIST_KEYWORDS = [
  'price list', 'rate list', 'rate card',
  'mrp', 'dealer price', 'retail price',
  // Hindi
  '\u0926\u0930 \u0938\u0942\u091A\u0940',
  '\u0930\u0947\u091F \u0932\u093F\u0938\u094D\u091F',
];

const STOCK_KEYWORDS = [
  'stock register', 'inventory', 'stock list',
  'opening stock', 'closing stock',
  // Hindi
  '\u0938\u094D\u091F\u0949\u0915', '\u092E\u093E\u0932',
];

module.exports = { DocClassifier };
