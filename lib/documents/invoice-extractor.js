// Invoice/receipt specialized extractor
// Handles GST invoices, cash memos, kachha bills, platform receipts,
// mixed-language invoices (English headers + Hindi/Tamil items)

const { DocParser } = require('./doc-parser');

class InvoiceExtractor {
  constructor() {
    this.parser = new DocParser();
  }

  /**
   * Extract structured invoice data from Sarvam Vision output.
   * @param {Object} sarvamOutput - { text, tables, metadata }
   * @returns {Object} Invoice data
   */
  extract(sarvamOutput) {
    const text = sarvamOutput.text || '';
    const tables = sarvamOutput.tables || [];

    const invoice = {
      vendor: this.extractVendor(text),
      invoice_number: this.extractInvoiceNumber(text),
      date: this.parser.extractDate(text),
      gstin: this.parser.extractGSTIN(text),
      items: this.extractLineItems(tables, text),
      subtotal: null,
      gst: null,
      total: null,
      payment_terms: this.extractPaymentTerms(text),
    };

    // Calculate subtotal from items if not explicitly found
    if (invoice.items.length > 0) {
      invoice.subtotal = invoice.items.reduce((s, i) => s + (i.amount || 0), 0);
    }

    // Extract explicit totals from text
    const totals = this.extractTotals(text);
    invoice.total = totals.total || invoice.subtotal;
    invoice.gst = totals.gst || null;

    // If we have total and subtotal, derive GST
    if (invoice.total && invoice.subtotal && !invoice.gst) {
      const diff = invoice.total - invoice.subtotal;
      if (diff > 0) invoice.gst = Math.round(diff * 100) / 100;
    }

    return invoice;
  }

  /**
   * Extract vendor name from document text.
   * Typically the first prominent line (before GSTIN, before "Tax Invoice")
   */
  extractVendor(text) {
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 5)) {
      const clean = line.trim();
      if (clean.length > 2 && clean.length < 100 &&
          !clean.match(/^(tax invoice|invoice|bill|receipt|date|gstin|gst|bill no|invoice no|sr\.?\s*no)/i) &&
          !clean.match(/^\d/) &&                    // skip date/number lines
          !clean.match(/^[+0-9()\s-]+$/)) {         // skip phone numbers
        return clean;
      }
    }
    return null;
  }

  /**
   * Extract invoice/bill number
   */
  extractInvoiceNumber(text) {
    const patterns = [
      /(?:invoice|bill|receipt|memo|challan)\s*(?:no|number|#)[.:=\s]*([A-Z0-9\-\/]+)/i,
      /(?:inv|bill)\s*[.:=\s]*([A-Z0-9\-\/]+)/i,
      /(?:bill\s*no|inv\s*no)\s*[.:=\s]*([A-Z0-9\-\/]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

  /**
   * Extract line items from tables, falling back to text parsing
   */
  extractLineItems(tables, text) {
    const items = [];

    // Try tables first (structured invoices)
    for (const table of tables) {
      const headers = (table.headers || []).map(h => h.toLowerCase());

      // Identify column indices
      const nameIdx = headers.findIndex(h =>
        h.includes('item') || h.includes('description') ||
        h.includes('product') || h.includes('particular'));
      const qtyIdx = headers.findIndex(h =>
        h.includes('qty') || h.includes('quantity'));
      const rateIdx = headers.findIndex(h =>
        h.includes('rate') || h.includes('price') || h.includes('mrp'));
      const amtIdx = headers.findIndex(h =>
        h.includes('amount') || h.includes('total') || h.includes('value'));
      const hsnIdx = headers.findIndex(h =>
        h.includes('hsn') || h.includes('sac'));

      for (const row of table.rows || []) {
        const cells = row.cells || row;
        if (!cells || cells.length === 0) continue;

        const name = (cells[nameIdx >= 0 ? nameIdx : 0] || '').trim();
        if (!name || name.match(/^(total|sub[\s-]?total|grand|tax|gst|cgst|sgst|igst|round)/i)) {
          continue; // Skip total/tax rows
        }

        items.push({
          name,
          quantity: parseFloat(cells[qtyIdx >= 0 ? qtyIdx : null]) || 1,
          rate: this._parseNumber(cells[rateIdx >= 0 ? rateIdx : null]),
          amount: this._parseNumber(cells[amtIdx >= 0 ? amtIdx : null]),
          hsn: hsnIdx >= 0 ? this._extractHSN(cells[hsnIdx]) : this._extractHSNFromCells(cells),
        });
      }
    }

    // If no tables, try to parse from text (informal/kachha bills)
    if (items.length === 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        // Pattern: Item Name  Qty × Rate = Amount
        const match = line.match(
          /(.+?)\s+(\d+)\s*[×xX*]\s*₹?([\d,]+(?:\.\d{1,2})?)\s*=?\s*₹?([\d,]+(?:\.\d{1,2})?)/
        );
        if (match) {
          items.push({
            name: match[1].trim(),
            quantity: parseInt(match[2]),
            rate: parseFloat(match[3].replace(/,/g, '')),
            amount: parseFloat(match[4].replace(/,/g, '')),
          });
          continue;
        }

        // Pattern: Item Name  ₹Amount (no qty/rate breakdown)
        const simpleMatch = line.match(
          /(.{3,40}?)\s+₹?([\d,]+(?:\.\d{1,2})?)$/
        );
        if (simpleMatch && !simpleMatch[1].match(/^(total|sub|gst|tax|cgst|sgst|date|bill)/i)) {
          items.push({
            name: simpleMatch[1].trim(),
            quantity: 1,
            rate: null,
            amount: parseFloat(simpleMatch[2].replace(/,/g, '')),
          });
        }
      }
    }

    return items;
  }

  /**
   * Extract total amounts from text (grand total, GST)
   */
  extractTotals(text) {
    const result = { subtotal: null, gst: null, total: null };
    const lower = text.toLowerCase();

    // Grand Total / Total Amount
    const totalPatterns = [
      /(?:grand\s*total|total\s*amount|net\s*amount|net\s*payable)[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:^|\n)\s*total[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/im,
    ];
    for (const pattern of totalPatterns) {
      const match = lower.match(pattern);
      if (match) {
        result.total = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }

    // GST amounts (combined CGST + SGST, or total tax)
    const gstPatterns = [
      /(?:cgst\s*\+?\s*sgst)[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:total\s*tax|gst\s*amount|tax\s*amount)[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:igst)[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pattern of gstPatterns) {
      const match = text.match(pattern);
      if (match) {
        result.gst = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }

    // If we found individual CGST and SGST, add them
    if (!result.gst) {
      const cgstMatch = text.match(/cgst[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i);
      const sgstMatch = text.match(/sgst[:\s₹Rs.]*([\d,]+(?:\.\d{1,2})?)/i);
      if (cgstMatch && sgstMatch) {
        result.gst = parseFloat(cgstMatch[1].replace(/,/g, '')) +
                     parseFloat(sgstMatch[1].replace(/,/g, ''));
      }
    }

    return result;
  }

  /**
   * Extract HSN/SAC code from a cell value
   */
  _extractHSN(cellValue) {
    if (!cellValue) return null;
    const match = String(cellValue).match(/\b\d{4,8}\b/);
    return match ? match[0] : null;
  }

  /**
   * Look for HSN code in any cell of a row
   */
  _extractHSNFromCells(cells) {
    if (!Array.isArray(cells)) return null;
    for (const cell of cells) {
      const match = String(cell).match(/\b\d{4,8}\b/);
      if (match && match[0].length >= 4) return match[0];
    }
    return null;
  }

  /**
   * Extract payment terms
   */
  extractPaymentTerms(text) {
    const match = text.match(
      /(?:payment|due|terms|credit)[:\s]*(net\s*\d+|immediate|on\s*delivery|cod|\d+\s*days?)/i
    );
    return match ? match[1].trim() : null;
  }

  /**
   * Parse a number from a string, removing currency symbols and commas
   */
  _parseNumber(str) {
    if (!str) return null;
    const cleaned = String(str).replace(/[₹Rs.,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
}

module.exports = { InvoiceExtractor };
