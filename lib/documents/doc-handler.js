// Document processing orchestrator
// Routes photos/PDFs through: Sarvam Vision → classify → extract → present
const fs = require('fs');
const path = require('path');
const { DocClassifier } = require('./doc-classifier');
const { DocParser } = require('./doc-parser');
const { InvoiceExtractor } = require('./invoice-extractor');

const TEMP_DIR = '/tmp/dhandhaphone-docs';

class DocHandler {
  /**
   * @param {SarvamClient} sarvamClient - Shared Sarvam API client
   * @param {Object} agent - Agent interface { reply(msg, text), process(text) }
   */
  constructor(sarvamClient, agent) {
    this.sarvam = sarvamClient;
    this.agent = agent;
    this.classifier = new DocClassifier();
    this.parser = new DocParser();
    this.invoiceExtractor = new InvoiceExtractor();
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  /**
   * Handle a photo/document sent via Telegram.
   * Full pipeline: download → OCR → classify → extract → present
   *
   * @param {Object} message - Telegram message with photo or document
   * @param {Object} context - { bot, ownerLanguage }
   */
  async handleDocument(message, context) {
    const { bot, ownerLanguage } = context;

    try {
      // Step 1: Download from Telegram
      const filePath = await this.downloadFromTelegram(message, bot);

      // Step 2: Send acknowledgment
      await this.agent.reply(message, '\uD83D\uDCC4 Reading the document...');

      // Step 3: Get language for Sarvam
      const language = this._mapLanguageCode(ownerLanguage);

      // Step 4: Process through Sarvam Vision
      const extracted = await this.sarvam.processDocument(filePath, {
        language: language,
        outputFormat: 'json',
      });

      // Step 5: Classify document type (caption overrides auto-classify)
      const caption = message.caption || null;
      const docType = this.classifier.classify(extracted, caption);

      // Step 6: Route to appropriate handler
      const result = await this._routeDocument(message, extracted, docType);

      // Step 7: Clean up temp file
      this._cleanupFile(filePath);

      return result;

    } catch (error) {
      console.error('Document handler error:', error.message);
      await this.agent.reply(message,
        '\uD83D\uDCC4 Could not read the document. The image may be too blurry ' +
        'or in an unsupported format. Please try again with a clearer photo.'
      );
      return { error: error.message };
    }
  }

  /**
   * Route to the appropriate document handler based on classification
   */
  async _routeDocument(message, extracted, docType) {
    switch (docType) {
      case 'invoice':
      case 'bill':
        return this.handleInvoiceOrReceipt(message, extracted, 'invoice');
      case 'receipt':
        return this.handleInvoiceOrReceipt(message, extracted, 'receipt');
      case 'business_card':
        return this.handleBusinessCard(message, extracted);
      case 'bank_statement':
        return this.handleBankStatement(message, extracted);
      case 'price_list':
        return this.handlePriceList(message, extracted);
      case 'handwritten_note':
        return this.handleHandwrittenNote(message, extracted);
      case 'stock_register':
        return this.handleStockRegister(message, extracted);
      default:
        return this.handleGenericDocument(message, extracted);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Document type handlers
  // ─────────────────────────────────────────────────────────────

  async handleInvoiceOrReceipt(message, extracted, docType) {
    const invoice = this.invoiceExtractor.extract(extracted);

    const itemSummary = invoice.items
      .slice(0, 3)
      .map(i => `${i.name}${i.quantity > 1 ? ' \u00D7 ' + i.quantity : ''}`)
      .join(', ');
    const more = invoice.items.length > 3
      ? ` +${invoice.items.length - 3} more` : '';

    let reply = `\uD83D\uDCC4 Read the ${docType}:\n`;
    if (invoice.vendor) reply += `From: ${invoice.vendor}\n`;
    if (invoice.items.length > 0) reply += `Items: ${itemSummary}${more}\n`;
    if (invoice.total) {
      reply += `Total: \u20B9${this._formatINR(invoice.total)}`;
      if (invoice.gst) reply += ` (incl GST \u20B9${this._formatINR(invoice.gst)})`;
      reply += '\n';
    }
    if (invoice.date) reply += `Date: ${invoice.date}\n`;
    if (invoice.invoice_number) reply += `${docType === 'receipt' ? 'Receipt' : 'Invoice'} #: ${invoice.invoice_number}\n`;

    const txnType = docType === 'receipt' ? 'credit' : 'debit';
    reply += `\nLog as ${txnType}? \u2705 / \u274C`;

    await this.agent.reply(message, reply);

    return {
      docType,
      action: 'confirm_transaction',
      data: {
        type: txnType,
        amount: invoice.total,
        counterparty: invoice.vendor,
        method: 'OTHER',
        source: 'ocr',
        ocr_document_type: docType,
        ocr_vendor: invoice.vendor,
        ocr_invoice_no: invoice.invoice_number,
        ocr_items: invoice.items,
        gstin: invoice.gstin,
        notes: `${docType}: ${invoice.invoice_number || 'no number'}`,
      },
    };
  }

  async handleBusinessCard(message, extracted) {
    const card = this.parser.parseBusinessCard(extracted);

    let reply = '\uD83D\uDCC7 Business card:\n';
    if (card.name) reply += card.name;
    if (card.company) reply += ` \u2014 ${card.company}`;
    reply += '\n';
    if (card.designation) reply += `${card.designation}\n`;
    if (card.phone) reply += `Phone: ${card.phone}\n`;
    if (card.email) reply += `Email: ${card.email}\n`;
    if (card.address) reply += `Address: ${card.address}\n`;
    reply += '\nSave as contact? \u2705 / \u274C';

    await this.agent.reply(message, reply);

    return {
      docType: 'business_card',
      action: 'confirm_contact',
      data: card,
    };
  }

  async handleBankStatement(message, extracted) {
    const transactions = this.parser.parseBankStatement(extracted);

    if (transactions.length === 0) {
      await this.agent.reply(message,
        '\uD83C\uDFE6 Bank statement received but could not extract transactions. ' +
        'The format may not be supported yet. Try sending individual pages.'
      );
      return { docType: 'bank_statement', action: 'failed', data: null };
    }

    const totalCredits = transactions.reduce((s, t) => s + (t.credit || 0), 0);
    const totalDebits = transactions.reduce((s, t) => s + (t.debit || 0), 0);
    const firstDate = transactions[0].date || '?';
    const lastDate = transactions[transactions.length - 1].date || '?';

    await this.agent.reply(message,
      `\uD83C\uDFE6 Bank statement: ${transactions.length} transactions found.\n` +
      `Period: ${firstDate} to ${lastDate}\n` +
      `Total credits: \u20B9${this._formatINR(totalCredits)}\n` +
      `Total debits: \u20B9${this._formatINR(totalDebits)}\n\n` +
      `Import all into ledger? \u2705 / \u274C`
    );

    return {
      docType: 'bank_statement',
      action: 'confirm_import',
      data: { transactions, totalCredits, totalDebits },
    };
  }

  async handlePriceList(message, extracted) {
    const items = this.parser.parsePriceList(extracted);

    if (items.length === 0) {
      await this.agent.reply(message,
        '\uD83D\uDCCB Price list received but could not extract items. ' +
        'Try a clearer photo or type the prices manually.'
      );
      return { docType: 'price_list', action: 'failed', data: null };
    }

    const preview = items.slice(0, 5).map(i =>
      `  ${i.name}: \u20B9${this._formatINR(i.price)}${i.unit ? '/' + i.unit : ''}`
    ).join('\n');
    const moreText = items.length > 5 ? `\n  ...+${items.length - 5} more` : '';

    await this.agent.reply(message,
      `\uD83D\uDCCB Price list: ${items.length} items found.\n${preview}${moreText}\n\n` +
      `Update prices? \u2705 / \u274C`
    );

    return {
      docType: 'price_list',
      action: 'confirm_prices',
      data: { items },
    };
  }

  async handleHandwrittenNote(message, extracted) {
    const text = extracted.text || extracted.content || '';

    if (!text.trim()) {
      await this.agent.reply(message,
        '\uD83D\uDCC4 Could not read the handwritten note. Some parts were not clear. ' +
        'Please type the important details.'
      );
      return { docType: 'handwritten_note', action: 'failed', data: null };
    }

    // Pass the extracted text to the agent for natural processing
    await this.agent.process(
      `[Owner sent a handwritten note. OCR extracted: "${text}"]\n` +
      `Process this as if the owner typed it.`
    );

    return {
      docType: 'handwritten_note',
      action: 'processed_as_text',
      data: { text },
    };
  }

  async handleStockRegister(message, extracted) {
    const items = this.parser.parseStockRegister(extracted);

    if (items.length === 0) {
      await this.agent.reply(message,
        '\uD83D\uDCE6 Stock register received but could not extract items. ' +
        'Try a clearer photo.'
      );
      return { docType: 'stock_register', action: 'failed', data: null };
    }

    const preview = items.slice(0, 5).map(i =>
      `  ${i.name}: ${i.quantity} ${i.unit || 'units'}`
    ).join('\n');
    const moreText = items.length > 5 ? `\n  ...+${items.length - 5} more` : '';

    await this.agent.reply(message,
      `\uD83D\uDCE6 Stock register: ${items.length} items found.\n${preview}${moreText}\n\n` +
      `Update inventory? \u2705 / \u274C`
    );

    return {
      docType: 'stock_register',
      action: 'confirm_inventory',
      data: { items },
    };
  }

  async handleGenericDocument(message, extracted) {
    const text = extracted.text || extracted.content || '';
    const preview = text.substring(0, 300);
    const truncated = text.length > 300 ? '...' : '';

    await this.agent.reply(message,
      `\uD83D\uDCC4 Document read. Here's what I found:\n"${preview}${truncated}"\n\n` +
      `What would you like me to do with this?`
    );

    return {
      docType: 'unknown',
      action: 'show_text',
      data: { text },
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  Telegram helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Download photo or document from Telegram to temp file
   */
  async downloadFromTelegram(message, bot) {
    let fileId;

    if (message.photo) {
      // Pick highest resolution (last in array)
      const largest = message.photo[message.photo.length - 1];
      fileId = largest.file_id;
    } else if (message.document) {
      fileId = message.document.file_id;
    }

    if (!fileId) {
      throw new Error('No file found in message');
    }

    const file = await bot.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;

    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const response = await fetchFn(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save to temp directory
    const ext = (file.file_path || '').split('.').pop() || 'jpg';
    const tempPath = path.join(TEMP_DIR, `doc-${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, buffer);

    return tempPath;
  }

  // ─────────────────────────────────────────────────────────────
  //  Utilities
  // ─────────────────────────────────────────────────────────────

  /**
   * Map owner language preference to Sarvam language code
   */
  _mapLanguageCode(pref) {
    const map = {
      'en': 'en-IN', 'hi': 'hi-IN',
      'bn': 'bn-IN', 'gu': 'gu-IN', 'kn': 'kn-IN',
      'ml': 'ml-IN', 'mr': 'mr-IN', 'or': 'od-IN',
      'pa': 'pa-IN', 'ta': 'ta-IN', 'te': 'te-IN',
      'ur': 'ur-IN', 'as': 'as-IN',
    };
    return map[pref] || 'en-IN';
  }

  /**
   * Format number as Indian numbering (1,50,000)
   */
  _formatINR(num) {
    if (num == null || isNaN(num)) return '0';
    return num.toLocaleString('en-IN');
  }

  /**
   * Clean up temp file
   */
  _cleanupFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch { /* ignore cleanup errors */ }
  }
}

module.exports = { DocHandler };
