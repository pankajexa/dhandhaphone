// Document field parser — extracts structured data from Sarvam Vision output
// Handles Indian phone numbers, GSTIN, ₹ amounts, Indian date formats

class DocParser {
  /**
   * Parse a business card from extracted text
   * @param {Object} extracted - Sarvam Vision output
   * @returns {Object} { name, company, phone, email, address, designation, raw_text }
   */
  parseBusinessCard(extracted) {
    const text = extracted.text || '';
    return {
      name: this.extractName(text),
      company: this.extractCompany(text),
      phone: this.extractPhone(text),
      email: this.extractEmail(text),
      address: this.extractAddress(text),
      designation: this.extractDesignation(text),
      raw_text: text,
    };
  }

  /**
   * Parse bank statement from extracted tables
   * @param {Object} extracted - Sarvam Vision output with tables
   * @returns {Array<Object>} Array of { date, description, debit, credit, balance }
   */
  parseBankStatement(extracted) {
    const tables = extracted.tables || [];
    const transactions = [];

    for (const table of tables) {
      const headers = (table.headers || []).map(h => h.toLowerCase());

      for (const row of table.rows || []) {
        const cells = row.cells || row;
        const txn = this._parseBankRow(cells, headers);
        if (txn && (txn.debit || txn.credit)) {
          transactions.push(txn);
        }
      }
    }
    return transactions;
  }

  /**
   * Parse price list from extracted tables
   * @returns {Array<Object>} Array of { name, price, unit }
   */
  parsePriceList(extracted) {
    const tables = extracted.tables || [];
    const items = [];

    for (const table of tables) {
      const headers = (table.headers || []).map(h => h.toLowerCase());

      for (const row of table.rows || []) {
        const cells = row.cells || row;
        const item = this._parsePriceRow(cells, headers);
        if (item && item.name) items.push(item);
      }
    }
    return items;
  }

  /**
   * Parse stock register from extracted tables
   * @returns {Array<Object>} Array of { name, quantity, unit }
   */
  parseStockRegister(extracted) {
    const tables = extracted.tables || [];
    const items = [];

    for (const table of tables) {
      const headers = (table.headers || []).map(h => h.toLowerCase());

      for (const row of table.rows || []) {
        const cells = row.cells || row;
        const item = this._parseStockRow(cells, headers);
        if (item && item.name) items.push(item);
      }
    }
    return items;
  }

  // ─────────────────────────────────────────────────────────────
  //  Field extractors
  // ─────────────────────────────────────────────────────────────

  /**
   * Extract Indian phone number from text
   * Handles: +91XXXXXXXXXX, 0XXXXXXXXXX, plain 10 digits starting with 6-9
   */
  extractPhone(text) {
    const match = text.match(/(?:\+91[\s-]?|0)?([6-9]\d{9})/);
    return match ? '+91' + match[1] : null;
  }

  /**
   * Extract email address from text
   */
  extractEmail(text) {
    const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[0].toLowerCase() : null;
  }

  /**
   * Extract GSTIN (GST Identification Number)
   * Format: 2-digit state + 10-char PAN + 1 entity + Z + checksum
   */
  extractGSTIN(text) {
    const match = text.match(/\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]\d/);
    return match ? match[0] : null;
  }

  /**
   * Extract all currency amounts from text
   * Matches ₹, Rs, Rs., INR prefixed amounts
   */
  extractAmounts(text) {
    const amounts = [];
    const regex = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) amounts.push(amount);
    }
    return amounts;
  }

  /**
   * Extract date from text (common Indian formats)
   * Returns raw date string — caller can parse further
   */
  extractDate(text) {
    const patterns = [
      /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/,           // DD/MM/YYYY or DD-MM-YYYY
      /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/,            // YYYY-MM-DD
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  }

  /**
   * Extract person name — first prominent non-keyword line
   */
  extractName(text) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 5)) {
      const clean = line.trim();
      // Name: 2-50 chars, not a keyword, not all caps long string (company usually)
      if (clean.length >= 2 && clean.length <= 50 &&
          !clean.match(/^(mobile|email|tel|fax|phone|address|www|http)/i) &&
          !clean.match(/^[+0-9()\s-]+$/) &&  // not a phone number
          !clean.match(/[@.]\w+/)) {           // not an email/URL
        return clean;
      }
    }
    return null;
  }

  /**
   * Extract company name — look for common suffixes
   */
  extractCompany(text) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const clean = line.trim();
      if (clean.match(/(?:pvt|ltd|llp|inc|corp|co\.|enterprises?|traders?|industries?|associates?|solutions?|services?|agency|group)/i)) {
        return clean;
      }
    }
    return null;
  }

  /**
   * Extract address — look for pin code or address keywords
   */
  extractAddress(text) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const clean = line.trim();
      // Indian pin codes are 6 digits
      if (clean.match(/\b\d{6}\b/) ||
          clean.match(/(?:road|street|nagar|colony|lane|plot|floor|market|bazaar|marg)/i)) {
        return clean;
      }
    }
    return null;
  }

  /**
   * Extract designation/title
   */
  extractDesignation(text) {
    const designations = [
      'proprietor', 'owner', 'director', 'manager', 'partner',
      'ceo', 'cfo', 'founder', 'co-founder', 'president',
      'sales manager', 'general manager', 'md', 'chairman',
    ];
    const lower = text.toLowerCase();
    for (const d of designations) {
      if (lower.includes(d)) return d.charAt(0).toUpperCase() + d.slice(1);
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  Table row parsers
  // ─────────────────────────────────────────────────────────────

  _parseBankRow(cells, headers) {
    if (!cells || cells.length < 3) return null;

    const dateIdx = headers.findIndex(h =>
      h.includes('date') || h.includes('txn'));
    const descIdx = headers.findIndex(h =>
      h.includes('description') || h.includes('particular') || h.includes('narration'));
    const debitIdx = headers.findIndex(h =>
      h.includes('debit') || h.includes('withdrawal') || h.includes('dr'));
    const creditIdx = headers.findIndex(h =>
      h.includes('credit') || h.includes('deposit') || h.includes('cr'));
    const balIdx = headers.findIndex(h =>
      h.includes('balance') || h.includes('bal'));

    return {
      date: cells[dateIdx >= 0 ? dateIdx : 0] || '',
      description: cells[descIdx >= 0 ? descIdx : 1] || '',
      debit: this._parseAmount(cells[debitIdx >= 0 ? debitIdx : 2]),
      credit: this._parseAmount(cells[creditIdx >= 0 ? creditIdx : 3]),
      balance: this._parseAmount(cells[balIdx >= 0 ? balIdx : cells.length - 1]),
    };
  }

  _parsePriceRow(cells, headers) {
    if (!cells || cells.length < 2) return null;

    const nameIdx = headers.findIndex(h =>
      h.includes('item') || h.includes('product') || h.includes('description') || h.includes('particular'));
    const priceIdx = headers.findIndex(h =>
      h.includes('price') || h.includes('rate') || h.includes('mrp') || h.includes('amount'));
    const unitIdx = headers.findIndex(h =>
      h.includes('unit') || h.includes('uom') || h.includes('per'));

    return {
      name: (cells[nameIdx >= 0 ? nameIdx : 0] || '').trim(),
      price: this._parseAmount(cells[priceIdx >= 0 ? priceIdx : 1]),
      unit: (cells[unitIdx >= 0 ? unitIdx : null] || '').trim() || null,
    };
  }

  _parseStockRow(cells, headers) {
    if (!cells || cells.length < 2) return null;

    const nameIdx = headers.findIndex(h =>
      h.includes('item') || h.includes('product') || h.includes('description'));
    const qtyIdx = headers.findIndex(h =>
      h.includes('qty') || h.includes('quantity') || h.includes('stock'));
    const unitIdx = headers.findIndex(h =>
      h.includes('unit') || h.includes('uom'));

    return {
      name: (cells[nameIdx >= 0 ? nameIdx : 0] || '').trim(),
      quantity: parseFloat(cells[qtyIdx >= 0 ? qtyIdx : 1]) || 0,
      unit: (cells[unitIdx >= 0 ? unitIdx : null] || '').trim() || null,
    };
  }

  /**
   * Parse a string into a number, removing currency symbols and commas
   */
  _parseAmount(str) {
    if (!str) return null;
    const cleaned = String(str).replace(/[₹Rs.,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
}

module.exports = { DocParser };
