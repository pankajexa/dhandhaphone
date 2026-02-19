// gateway/ingestion/bulk-import.js — Batch import of multiple transactions for DhandhaPhone
// Handles: bank passbook photos, PDF statements, app screenshots, CSV exports, Khatabook/Vyapar exports
// Each batch is deduped against existing transactions before import.

'use strict';

// ── Multilingual import result templates ──────────────────────────────
const IMPORT_TEMPLATES = {
  en: "Imported {imported} transactions from your {type}. {dupes} were already recorded. Please review — say 'sahi hai' to confirm or tell me what's wrong.",
  hi: "Aapke {type} se {imported} transactions import kiye. {dupes} pehle se the. Dekh lo — 'sahi hai' bolo ya galti batao.",
  te: "Mee {type} nundi {imported} transactions import chesamu. {dupes} mundu nundi unnaayi. Choodandi — 'correct' cheppandi leda tappulu cheppandi.",
  ta: "Unga {type} la irundhu {imported} transactions import panninom. {dupes} munnadi irundhadhu. Parunga — 'sari' sollungal illa thappugal sollungal.",
};

// ── Document type display names per language ──────────────────────────
const DOC_TYPE_NAMES = {
  en: { passbook_photo: 'passbook photo', pdf_statement: 'bank statement', app_screenshot: 'app screenshot', csv_export: 'CSV export' },
  hi: { passbook_photo: 'passbook photo', pdf_statement: 'bank statement', app_screenshot: 'app screenshot', csv_export: 'CSV export' },
  te: { passbook_photo: 'passbook photo', pdf_statement: 'bank statement', app_screenshot: 'app screenshot', csv_export: 'CSV export' },
  ta: { passbook_photo: 'passbook photo', pdf_statement: 'bank statement', app_screenshot: 'app screenshot', csv_export: 'CSV export' },
};

// ── Confidence scores by document type ────────────────────────────────
const CONFIDENCE_MAP = {
  passbook_photo: 0.75,
  pdf_statement:  0.90,
  app_screenshot: 0.80,
  csv_export:     0.95,
};

class BulkImporter {
  /**
   * @param {Object} db - DhandhaDB instance with .db (raw better-sqlite3) and .addTransaction()
   */
  constructor(db) {
    this.db = db;
  }

  // ====================================================================
  // importBatch — Main entry point
  // ====================================================================

  /**
   * Import a batch of pre-parsed transactions into the ledger.
   *
   * @param {Array<Object>} transactions - Array of transaction objects (see shape below)
   * @param {string} documentType - One of: passbook_photo, pdf_statement, app_screenshot, csv_export
   * @param {string} [language='en'] - Language code for result message
   * @returns {{ batchId: string, total: number, imported: number, duplicates: number, language: string }}
   *
   * Transaction shape:
   *   { type: 'credit'|'debit', amount: Number, counterparty_name: String|null,
   *     method: String, reference_id: String|null, transaction_date: String,
   *     description: String|null }
   */
  importBatch(transactions, documentType, language) {
    language = language || 'en';
    const batchId = 'batch_' + Date.now();
    const confidence = this.getConfidence(documentType);

    // Dedup the batch against existing DB records
    const { newTxns, dupes } = this.dedupBatch(transactions);

    // Write new transactions inside a single SQLite transaction for atomicity
    let imported = 0;
    this.db.db.exec('BEGIN');
    try {
      for (const txn of newTxns) {
        this.db.addTransaction({
          type: txn.type,
          amount: txn.amount,
          counterparty_name: txn.counterparty_name || null,
          method: txn.method || 'OTHER',
          reference_id: txn.reference_id || null,
          transaction_date: txn.transaction_date || new Date().toISOString().split('T')[0],
          description: txn.description || null,
          source: 'bank_import',
          batch_id: batchId,
          is_confirmed: 0,
          confidence: confidence,
        });
        imported++;
      }
      this.db.db.exec('COMMIT');
    } catch (err) {
      this.db.db.exec('ROLLBACK');
      throw err;
    }

    return {
      batchId,
      total: transactions.length,
      imported,
      duplicates: dupes.length,
      language,
    };
  }

  // ====================================================================
  // dedupBatch — Batch deduplication
  // ====================================================================

  /**
   * Check each transaction against existing DB records.
   *
   * Tier 1: reference_id match (strongest — definitively the same txn)
   * Tier 2: amount + transaction_date + type on the same day (likely dupe)
   *
   * @param {Array<Object>} transactions
   * @returns {{ newTxns: Array<Object>, dupes: Array<Object> }}
   */
  dedupBatch(transactions) {
    const newTxns = [];
    const dupes = [];

    // Prepare statements once, reuse for every row
    const stmtByRef = this.db.db.prepare(`
      SELECT id FROM transactions
      WHERE reference_id = ? AND is_deleted = 0
    `);

    const stmtByAmountDateType = this.db.db.prepare(`
      SELECT id FROM transactions
      WHERE amount = ? AND transaction_date = ?
        AND type = ? AND is_deleted = 0
    `);

    for (const txn of transactions) {
      // Tier 1: Reference ID match
      if (txn.reference_id) {
        const refMatch = stmtByRef.get(txn.reference_id);
        if (refMatch) {
          dupes.push(txn);
          continue;
        }
      }

      // Tier 2: Same amount + date + type on the same day
      const sameDayMatch = stmtByAmountDateType.get(
        txn.amount,
        txn.transaction_date,
        txn.type
      );
      if (sameDayMatch) {
        dupes.push(txn);
        continue;
      }

      newTxns.push(txn);
    }

    return { newTxns, dupes };
  }

  // ====================================================================
  // parsePassbookRows — OCR text from passbook photo
  // ====================================================================

  /**
   * Parse OCR text from a bank passbook photo into transaction objects.
   *
   * Indian bank passbooks typically have columns:
   *   Date | Description/Particulars | Debit | Credit | Balance
   *
   * Lines with at least a date and one numeric amount are treated as rows.
   * The balance column is extracted but not stored — it can be used for
   * verification checksums by the caller.
   *
   * @param {string} ocrText - Raw OCR output from passbook image
   * @returns {Array<Object>} Parsed transaction objects
   */
  parsePassbookRows(ocrText) {
    if (!ocrText || typeof ocrText !== 'string') return [];

    const transactions = [];
    const lines = ocrText.split('\n');

    // Date patterns common in Indian passbooks: DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, DD-MM-YY
    const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    // Amount pattern: digits with optional commas and decimals
    const amountPattern = /(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/g;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Must contain a date to be a transaction row
      const dateMatch = trimmed.match(datePattern);
      if (!dateMatch) continue;

      // Parse the date into YYYY-MM-DD
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      let year = dateMatch[3];
      if (year.length === 2) {
        year = (parseInt(year, 10) > 50 ? '19' : '20') + year;
      }
      const transactionDate = `${year}-${month}-${day}`;

      // Extract all numeric amounts from the line
      const amounts = [];
      let m;
      // Reset lastIndex by creating a fresh regex each time
      const amtRegex = /(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/g;
      while ((m = amtRegex.exec(trimmed)) !== null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        // Skip very small numbers likely to be date fragments (day, month, year)
        if (val >= 1) {
          amounts.push(val);
        }
      }

      // Filter out date components that got captured as amounts
      const dateComponents = [
        parseInt(dateMatch[1], 10),
        parseInt(dateMatch[2], 10),
        parseInt(dateMatch[3], 10),
      ];
      const financialAmounts = amounts.filter(
        (a) => !dateComponents.includes(a)
      );

      if (financialAmounts.length === 0) continue;

      // Extract description: text between the date and the first amount after the date
      const dateEnd = trimmed.indexOf(dateMatch[0]) + dateMatch[0].length;
      let description = trimmed.substring(dateEnd).trim();
      // Remove numeric portions from the description to get just the text part
      description = description
        .replace(/(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim() || null;

      // Extract reference ID from description if present
      let referenceId = null;
      if (description) {
        const refMatch = description.match(
          /(?:UPI[\s\/:-]*|ref[\s:]*|txn[\s:]*|chq[\s:]*|cheque[\s:]*)(\d{6,12})/i
        );
        if (refMatch) {
          referenceId = refMatch[1];
        }
      }

      // Determine debit vs credit:
      // In passbooks with 3+ financial amounts, typically: debit, credit, balance
      // With 2 amounts: one is debit/credit, other is balance
      // With 1 amount: need context clues
      let type = 'debit';
      let amount = 0;

      if (financialAmounts.length >= 3) {
        // [debit, credit, balance] — one of debit/credit is usually 0 or absent
        const debitAmt = financialAmounts[0];
        const creditAmt = financialAmounts[1];
        // balance = financialAmounts[2] — available for verification

        if (creditAmt > 0 && debitAmt === 0) {
          type = 'credit';
          amount = creditAmt;
        } else if (debitAmt > 0) {
          type = 'debit';
          amount = debitAmt;
        } else {
          type = 'credit';
          amount = creditAmt;
        }
      } else if (financialAmounts.length === 2) {
        // Likely [amount, balance]
        amount = financialAmounts[0];
        // Use keywords in description to guess type
        if (description && /\b(?:cr|credit|deposit|received|by)\b/i.test(description)) {
          type = 'credit';
        } else {
          type = 'debit';
        }
      } else {
        // Single amount
        amount = financialAmounts[0];
        if (description && /\b(?:cr|credit|deposit|received|by)\b/i.test(description)) {
          type = 'credit';
        } else {
          type = 'debit';
        }
      }

      if (amount <= 0) continue;

      transactions.push({
        type,
        amount,
        counterparty_name: null,
        method: referenceId ? 'UPI' : 'OTHER',
        reference_id: referenceId,
        transaction_date: transactionDate,
        description,
      });
    }

    return transactions;
  }

  // ====================================================================
  // parseStatementRows — Extracted PDF text
  // ====================================================================

  /**
   * Parse extracted text from a PDF bank statement.
   * PDF statements have cleaner formatting than passbook photos.
   * Column layout is similar: Date | Description | Debit | Credit | Balance
   *
   * @param {string} pdfText - Extracted text from PDF
   * @returns {Array<Object>} Parsed transaction objects
   */
  parseStatementRows(pdfText) {
    if (!pdfText || typeof pdfText !== 'string') return [];

    const transactions = [];
    const lines = pdfText.split('\n');

    // PDF statements often use tab or multi-space as column separators
    const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const dateMatch = trimmed.match(datePattern);
      if (!dateMatch) continue;

      // Parse date
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      let year = dateMatch[3];
      if (year.length === 2) {
        year = (parseInt(year, 10) > 50 ? '19' : '20') + year;
      }
      const transactionDate = `${year}-${month}-${day}`;

      // Split line into columns using 2+ spaces or tabs
      const columns = trimmed.split(/\s{2,}|\t/).map((c) => c.trim()).filter(Boolean);

      // We need at least 3 columns: date-containing, one amount, balance
      if (columns.length < 3) continue;

      // Find which column contains the date — subsequent columns are description + amounts
      let dateColIdx = -1;
      for (let i = 0; i < columns.length; i++) {
        if (datePattern.test(columns[i])) {
          dateColIdx = i;
          break;
        }
      }
      if (dateColIdx === -1) continue;

      // Gather description and numeric columns after the date
      let description = null;
      const numericCols = [];

      for (let i = dateColIdx + 1; i < columns.length; i++) {
        const cleaned = columns[i].replace(/,/g, '');
        if (/^\d+(\.\d{1,2})?$/.test(cleaned) || /^-$/.test(columns[i].trim())) {
          // Numeric column (amount) or dash (no value)
          if (columns[i].trim() === '-') {
            numericCols.push(0);
          } else {
            numericCols.push(parseFloat(cleaned));
          }
        } else if (description === null) {
          description = columns[i];
        } else {
          // Additional text columns — append to description
          description += ' ' + columns[i];
        }
      }

      if (numericCols.length === 0) continue;

      // Extract reference ID from description
      let referenceId = null;
      if (description) {
        const refMatch = description.match(
          /(?:UPI[\s\/:-]*|ref[\s:]*|txn[\s:]*|chq[\s:]*|cheque[\s:]*)(\d{6,12})/i
        );
        if (refMatch) {
          referenceId = refMatch[1];
        }
      }

      // Determine type and amount from numeric columns
      // Typical PDF layout: [debit, credit, balance] or [withdrawal, deposit, balance]
      let type = 'debit';
      let amount = 0;

      if (numericCols.length >= 3) {
        const debitAmt = numericCols[0];
        const creditAmt = numericCols[1];
        // numericCols[2] is balance

        if (creditAmt > 0 && debitAmt === 0) {
          type = 'credit';
          amount = creditAmt;
        } else if (debitAmt > 0) {
          type = 'debit';
          amount = debitAmt;
        } else {
          type = 'credit';
          amount = creditAmt;
        }
      } else if (numericCols.length === 2) {
        amount = numericCols[0];
        if (description && /\b(?:cr|credit|deposit|received)\b/i.test(description)) {
          type = 'credit';
        } else {
          type = 'debit';
        }
      } else {
        amount = numericCols[0];
        if (description && /\b(?:cr|credit|deposit|received)\b/i.test(description)) {
          type = 'credit';
        } else {
          type = 'debit';
        }
      }

      if (amount <= 0) continue;

      transactions.push({
        type,
        amount,
        counterparty_name: null,
        method: referenceId ? 'UPI' : 'OTHER',
        reference_id: referenceId,
        transaction_date: transactionDate,
        description: description || null,
      });
    }

    return transactions;
  }

  // ====================================================================
  // parseCSV — CSV export from banking apps / Khatabook / Vyapar
  // ====================================================================

  /**
   * Parse CSV data into transaction objects.
   * Flexible column detection: looks for common header names across
   * different bank and app export formats.
   *
   * @param {string} csvData - Raw CSV text
   * @returns {Array<Object>} Parsed transaction objects
   */
  parseCSV(csvData) {
    if (!csvData || typeof csvData !== 'string') return [];

    const lines = csvData.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    // ── Detect and parse header row ────────────────────────────────
    const headerLine = lines[0];
    const headers = this._splitCSVLine(headerLine).map((h) =>
      h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '')
    );

    // Map known column name variants to our canonical field names
    const columnMap = this._detectColumns(headers);

    if (!columnMap.amount && !columnMap.debit && !columnMap.credit) {
      // Cannot find any amount column — bail
      return [];
    }

    // ── Parse data rows ────────────────────────────────────────────
    const transactions = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this._splitCSVLine(lines[i]);
      if (values.length === 0) continue;

      // Extract fields using column map
      const rawDate = columnMap.date != null ? values[columnMap.date] : null;
      const rawAmount = columnMap.amount != null ? values[columnMap.amount] : null;
      const rawDebit = columnMap.debit != null ? values[columnMap.debit] : null;
      const rawCredit = columnMap.credit != null ? values[columnMap.credit] : null;
      const rawDescription = columnMap.description != null ? values[columnMap.description] : null;
      const rawReference = columnMap.reference != null ? values[columnMap.reference] : null;
      const rawCounterparty = columnMap.counterparty != null ? values[columnMap.counterparty] : null;
      const rawType = columnMap.type != null ? values[columnMap.type] : null;

      // Parse date
      let transactionDate = this._parseDate(rawDate);
      if (!transactionDate) {
        // If we can't parse the date, use today
        transactionDate = new Date().toISOString().split('T')[0];
      }

      // Parse amount and determine type
      let type = 'debit';
      let amount = 0;

      if (rawDebit != null || rawCredit != null) {
        // Separate debit/credit columns
        const debitAmt = this._parseAmount(rawDebit);
        const creditAmt = this._parseAmount(rawCredit);

        if (creditAmt > 0 && debitAmt === 0) {
          type = 'credit';
          amount = creditAmt;
        } else if (debitAmt > 0) {
          type = 'debit';
          amount = debitAmt;
        } else if (creditAmt > 0) {
          type = 'credit';
          amount = creditAmt;
        }
      } else if (rawAmount != null) {
        amount = this._parseAmount(rawAmount);
        // Negative amounts are debits in some formats
        if (amount < 0) {
          type = 'debit';
          amount = Math.abs(amount);
        } else {
          // Check type column or default to credit for positive
          if (rawType && /\b(?:debit|dr|withdrawal|expense|paid|sent)\b/i.test(rawType)) {
            type = 'debit';
          } else if (rawType && /\b(?:credit|cr|deposit|income|received)\b/i.test(rawType)) {
            type = 'credit';
          } else {
            // Without explicit type info, positive amounts default to credit
            type = 'credit';
          }
        }
      }

      if (amount <= 0) continue;

      // Detect method from description or reference
      let method = 'OTHER';
      const combinedText = `${rawDescription || ''} ${rawReference || ''}`;
      if (/\bUPI\b/i.test(combinedText)) method = 'UPI';
      else if (/\bNEFT\b/i.test(combinedText)) method = 'NEFT';
      else if (/\bIMPS\b/i.test(combinedText)) method = 'IMPS';
      else if (/\bRTGS\b/i.test(combinedText)) method = 'RTGS';
      else if (/\bATM\b/i.test(combinedText)) method = 'ATM';
      else if (/\bPOS\b/i.test(combinedText)) method = 'POS';
      else if (/\bcash\b/i.test(combinedText)) method = 'CASH';
      else if (/\bcheque?\b/i.test(combinedText)) method = 'CHEQUE';

      transactions.push({
        type,
        amount,
        counterparty_name: (rawCounterparty || '').trim() || null,
        method,
        reference_id: (rawReference || '').trim() || null,
        transaction_date: transactionDate,
        description: (rawDescription || '').trim() || null,
      });
    }

    return transactions;
  }

  // ====================================================================
  // getConfidence — Confidence score by document type
  // ====================================================================

  /**
   * Return confidence score for a given document type.
   *
   * @param {string} documentType
   * @returns {number} Confidence between 0 and 1
   */
  getConfidence(documentType) {
    return CONFIDENCE_MAP[documentType] || 0.70;
  }

  // ====================================================================
  // getImportMessage — Multilingual result message
  // ====================================================================

  /**
   * Generate a human-readable import result message in the owner's language.
   *
   * @param {{ batchId: string, total: number, imported: number, duplicates: number }} result
   * @param {string} [language='en'] - Language code
   * @returns {string} Formatted message
   */
  getImportMessage(result, language) {
    language = language || 'en';
    const template = IMPORT_TEMPLATES[language] || IMPORT_TEMPLATES.en;
    const docNames = DOC_TYPE_NAMES[language] || DOC_TYPE_NAMES.en;

    // Infer document type name from batchId or fall back to generic
    const typeName = result.documentType
      ? (docNames[result.documentType] || result.documentType)
      : 'document';

    return template
      .replace('{imported}', String(result.imported))
      .replace('{type}', typeName)
      .replace('{dupes}', String(result.duplicates));
  }

  // ====================================================================
  // Private helpers
  // ====================================================================

  /**
   * Split a CSV line respecting quoted fields.
   * Handles: "field with, comma","normal field",123
   *
   * @param {string} line
   * @returns {string[]}
   */
  _splitCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inQuotes) {
        if (ch === '"') {
          // Check for escaped quote ""
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++; // skip next quote
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    // Push last field
    fields.push(current.trim());

    return fields;
  }

  /**
   * Detect column indices from header names.
   * Maps known variants to canonical names: date, amount, debit, credit,
   * description, reference, counterparty, type.
   *
   * @param {string[]} headers - Lowercased, normalized header names
   * @returns {Object} Map of canonical name -> column index (or null if not found)
   */
  _detectColumns(headers) {
    const map = {
      date: null,
      amount: null,
      debit: null,
      credit: null,
      description: null,
      reference: null,
      counterparty: null,
      type: null,
    };

    const matchers = {
      date:         /^(?:date|txn_date|transaction_date|value_date|posting_date|dated)$/,
      amount:       /^(?:amount|txn_amount|transaction_amount|total|value)$/,
      debit:        /^(?:debit|dr|withdrawal|debit_amount|withdrawn)$/,
      credit:       /^(?:credit|cr|deposit|credit_amount|deposited)$/,
      description:  /^(?:description|particulars|narration|details|remarks|memo|note)$/,
      reference:    /^(?:reference|ref|ref_id|reference_id|reference_no|txn_ref|utr|rrn|cheque_no)$/,
      counterparty: /^(?:counterparty|party|name|customer|payee|payer|beneficiary|merchant)$/,
      type:         /^(?:type|txn_type|transaction_type|cr_dr|dr_cr)$/,
    };

    for (let i = 0; i < headers.length; i++) {
      for (const [field, pattern] of Object.entries(matchers)) {
        if (map[field] === null && pattern.test(headers[i])) {
          map[field] = i;
        }
      }
    }

    return map;
  }

  /**
   * Parse an Indian-format date string into YYYY-MM-DD.
   * Supports: DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, YYYY-MM-DD, DD Mon YYYY
   *
   * @param {string} raw
   * @returns {string|null} YYYY-MM-DD or null
   */
  _parseDate(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // DD/MM/YYYY or DD-MM-YYYY
    const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      let year = slashMatch[3];
      if (year.length === 2) {
        year = (parseInt(year, 10) > 50 ? '19' : '20') + year;
      }
      return `${year}-${month}-${day}`;
    }

    // DD Mon YYYY (e.g. "15 Jan 2024")
    const monthNames = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const monMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (monMatch) {
      const monthNum = monthNames[monMatch[2].toLowerCase()];
      if (monthNum) {
        return `${monMatch[3]}-${monthNum}-${monMatch[1].padStart(2, '0')}`;
      }
    }

    return null;
  }

  /**
   * Parse a numeric amount string, stripping commas and currency symbols.
   *
   * @param {string} raw
   * @returns {number} Parsed amount (0 if unparseable)
   */
  _parseAmount(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    const cleaned = raw.replace(/[₹$,\s]/g, '').replace(/^(Rs\.?|INR)\s*/i, '');
    if (!cleaned || cleaned === '-') return 0;
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }
}

module.exports = { BulkImporter };
