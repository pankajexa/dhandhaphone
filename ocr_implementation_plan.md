# DhandhaPhone — Sarvam Vision Document Intelligence Plan

## What We're Building

Replace the current "look at the image with LLM vision" approach
with Sarvam Vision's Document Intelligence API. This gives us:

1. **Invoice/receipt OCR** — Owner photographs a bill → structured
   extraction of vendor, amount, items, GST, date → auto-logs everything
2. **Handwritten note capture** — Owner's scribbled daily accounts
   → digitized into the ledger
3. **Business card reading** — Supplier/customer card → auto-creates
   contact with name, phone, address
4. **Any Indian language document** — Works across 23 languages and
   all major scripts, including mixed-language documents
5. **Table and chart parsing** — Price lists, stock sheets, bank
   statements → structured data

All through the same Sarvam API key we're already using for voice.

---

## Why Sarvam Vision Over Current Approach

| | Current (LLM Vision) | Sarvam Vision |
|---|---|---|
| How it works | Send image to Claude/DeepSeek as base64, ask it to extract data | Dedicated document intelligence pipeline with structured output |
| Indian languages | Poor — frontier models treat Indic scripts as secondary | 23 languages, best-in-class for Indian scripts |
| Accuracy | ~60-70% on Indian documents | 84.3% olmOCR, 87.36% Indic word accuracy |
| Table extraction | Hit or miss, unstructured text output | Structured HTML/Markdown tables |
| Cost per document | ~₹2-5 per image (LLM tokens for vision) | Free until Feb 28, then ~₹0.60/page |
| Mixed scripts | Struggles with Hindi+English on same page | Native mixed-script support |
| Handwriting | Very unreliable | Trained on Indian handwriting samples |
| Speed | 5-15 seconds (LLM inference) | 2-5 seconds (dedicated pipeline) |

---

## API Architecture

Sarvam Vision uses an async job-based pipeline:

```
Owner sends photo
       ↓
1. Create job (POST /doc-digitization/job/v1)
   → Returns job_id
       ↓
2. Get upload URL (GET /doc-digitization/upload/{job_id})
   → Returns presigned URL
       ↓
3. Upload file to presigned URL (PUT)
       ↓
4. Start processing (POST /doc-digitization/start/{job_id})
       ↓
5. Poll status (GET /doc-digitization/status/{job_id})
   → States: Accepted → Pending → Running → Completed
       ↓
6. Download output (GET /doc-digitization/download/{job_id})
   → Returns ZIP with Markdown/HTML/JSON
       ↓
7. Parse structured output → update workspace files
```

This async pattern is fine for Telegram. Owner sends a photo,
we reply "📄 Reading..." and process in background. Typical
document takes 2-5 seconds. We reply when done.

---

## File Changes Map

### Restructure: gateway/sarvam/ (shared Sarvam module)

Since we now use Sarvam for voice AND documents, the client
should live in a shared location instead of under voice/.

```
gateway/
├── sarvam/                      # Shared Sarvam API module
│   ├── sarvam-client.js         # MODIFIED: add document intelligence methods
│   └── sarvam-config.json       # MODIFIED: add document intelligence settings
├── voice/                       # Voice-specific pipeline
│   ├── voice-handler.js         # Uses sarvam/ for STT/TTS
│   ├── tts-generator.js
│   └── audio-utils.js
├── documents/                   # NEW: Document processing pipeline
│   ├── doc-handler.js           # Main document processing orchestrator
│   ├── doc-parser.js            # Parses Sarvam output into business data
│   ├── doc-classifier.js        # Classifies document type from extracted text
│   └── invoice-extractor.js     # Invoice/receipt specific extraction logic
├── skills/
├── config/
├── lib/
└── index.js
```

### NEW FILES

#### `gateway/documents/doc-handler.js`
Main orchestrator for document processing.

```javascript
class DocHandler {
  constructor(sarvamClient, agent) {
    this.sarvam = sarvamClient;
    this.agent = agent;
    this.parser = new DocParser();
    this.classifier = new DocClassifier();
    this.invoiceExtractor = new InvoiceExtractor();
  }

  /**
   * Handle a photo/document sent via Telegram
   * @param {Object} message - Telegram message with photo or document
   */
  async handleDocument(message) {
    // Step 1: Download from Telegram
    const filePath = await this.downloadFromTelegram(message);
    const fileType = this.getFileType(filePath); // jpg, png, pdf

    // Step 2: Send acknowledgment
    await this.agent.reply(message, '📄 Reading the document...');

    // Step 3: Get owner's language for Sarvam
    const profile = await this.agent.readProfile();
    const language = this.mapLanguageCode(profile.language_preference);

    // Step 4: Process through Sarvam Vision
    const extracted = await this.sarvam.processDocument(filePath, {
      language: language,
      outputFormat: 'json'  // JSON for programmatic parsing
    });

    // Step 5: Classify what type of document this is
    const docType = this.classifier.classify(extracted);

    // Step 6: Route to appropriate handler
    switch (docType) {
      case 'invoice':
      case 'receipt':
      case 'bill':
        return this.handleInvoiceOrReceipt(message, extracted, docType);

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

  async handleInvoiceOrReceipt(message, extracted, docType) {
    const invoice = this.invoiceExtractor.extract(extracted);
    // invoice = {
    //   vendor: "Krishna Traders",
    //   invoice_number: "INV-2026-0142",
    //   date: "2026-02-15",
    //   items: [{name: "Rice 25kg", qty: 10, rate: 2400, amount: 24000}],
    //   subtotal: 24000,
    //   gst: 1200,
    //   total: 25200,
    //   gst_number: "36AABCK1234H1ZN"
    // }

    // Auto-actions:
    // 1. Log transaction in ledger
    const txn = {
      type: docType === 'receipt' ? 'credit' : 'debit',
      amount: invoice.total,
      counterparty: invoice.vendor,
      method: 'OTHER',
      source: 'ocr',
      category: this.inferCategory(invoice),
      notes: `${docType}: ${invoice.invoice_number || 'no number'}`
    };

    // 2. Create/update contact
    // 3. Update inventory if items are trackable
    // 4. Store GST number if present

    // Confirm with owner before logging (financial action)
    const itemSummary = invoice.items
      .slice(0, 3)
      .map(i => `${i.name} × ${i.qty}`)
      .join(', ');
    const more = invoice.items.length > 3
      ? ` +${invoice.items.length - 3} more` : '';

    await this.agent.reply(message,
      `📄 Read the ${docType}:\n` +
      `From: ${invoice.vendor}\n` +
      `Items: ${itemSummary}${more}\n` +
      `Total: ₹${this.formatINR(invoice.total)}` +
      (invoice.gst ? ` (incl GST ₹${this.formatINR(invoice.gst)})` : '') +
      `\n\nLog as ${txn.type}? ✅ / ❌`
    );

    // Wait for confirmation before writing to ledger
  }

  async handleBusinessCard(message, extracted) {
    const card = this.parser.parseBusinessCard(extracted);
    // card = {
    //   name: "Rajesh Menon",
    //   company: "Menon Electronics",
    //   phone: "+919876543210",
    //   email: "rajesh@menonelec.com",
    //   address: "MG Road, Kochi",
    //   designation: "Owner"
    // }

    // Auto-create contact
    await this.agent.reply(message,
      `📇 Business card:\n` +
      `${card.name}` +
      (card.company ? ` — ${card.company}` : '') +
      (card.phone ? `\nPhone: ${card.phone}` : '') +
      (card.email ? `\nEmail: ${card.email}` : '') +
      `\n\nSave as contact? ✅ / ❌`
    );
  }

  async handleBankStatement(message, extracted) {
    const transactions = this.parser.parseBankStatement(extracted);
    // Array of {date, description, debit, credit, balance}

    await this.agent.reply(message,
      `🏦 Bank statement: ${transactions.length} transactions found.\n` +
      `Period: ${transactions[0]?.date} to ${transactions[transactions.length-1]?.date}\n` +
      `Total credits: ₹${this.formatINR(this.sumField(transactions, 'credit'))}\n` +
      `Total debits: ₹${this.formatINR(this.sumField(transactions, 'debit'))}\n\n` +
      `Import all into ledger? ✅ / ❌`
    );
  }

  async handlePriceList(message, extracted) {
    const items = this.parser.parsePriceList(extracted);
    // [{name, price, unit}]

    await this.agent.reply(message,
      `📋 Price list: ${items.length} items found.\n` +
      items.slice(0, 5).map(i =>
        `  ${i.name}: ₹${this.formatINR(i.price)}/${i.unit || 'unit'}`
      ).join('\n') +
      (items.length > 5 ? `\n  ...+${items.length - 5} more` : '') +
      `\n\nUpdate prices? ✅ / ❌`
    );
  }

  async handleHandwrittenNote(message, extracted) {
    // Just show what was read, let the agent figure out the intent
    const text = extracted.text || extracted.content;
    await this.agent.process(
      `[Owner sent a handwritten note. OCR extracted: "${text}"]\n` +
      `Process this as if the owner typed it.`
    );
  }

  async handleStockRegister(message, extracted) {
    const items = this.parser.parseStockRegister(extracted);
    await this.agent.reply(message,
      `📦 Stock register: ${items.length} items found.\n` +
      items.slice(0, 5).map(i =>
        `  ${i.name}: ${i.quantity} ${i.unit || 'units'}`
      ).join('\n') +
      (items.length > 5 ? `\n  ...+${items.length - 5} more` : '') +
      `\n\nUpdate inventory? ✅ / ❌`
    );
  }

  async handleGenericDocument(message, extracted) {
    // Can't classify — show extracted text and let agent handle
    const text = extracted.text || extracted.content;
    const preview = text.substring(0, 300);
    await this.agent.reply(message,
      `📄 Document read. Here's what I found:\n"${preview}${text.length > 300 ? '...' : ''}"\n\n` +
      `What would you like me to do with this?`
    );
  }

  mapLanguageCode(pref) {
    const map = {
      'en': 'en-IN', 'hi': 'hi-IN', 'hinglish': 'hi-IN',
      'bn': 'bn-IN', 'gu': 'gu-IN', 'kn': 'kn-IN',
      'ml': 'ml-IN', 'mr': 'mr-IN', 'or': 'od-IN',
      'pa': 'pa-IN', 'ta': 'ta-IN', 'te': 'te-IN',
      'ur': 'ur-IN', 'as': 'as-IN',
    };
    return map[pref] || 'en-IN';
  }

  formatINR(num) {
    // Format as Indian numbering: 1,50,000
    return num.toLocaleString('en-IN');
  }
}
```

#### `gateway/documents/doc-classifier.js`
Classifies documents from extracted text content.

```javascript
class DocClassifier {
  /**
   * Classify document type from Sarvam Vision output
   * Uses keyword matching + structural analysis
   * No LLM call needed — this is fast local classification
   */
  classify(extracted) {
    const text = (extracted.text || extracted.content || '').toLowerCase();
    const hasTables = extracted.tables && extracted.tables.length > 0;

    // Invoice / Bill indicators
    const invoiceKeywords = [
      'invoice', 'bill', 'tax invoice', 'gst',
      'gstin', 'hsn', 'sac', 'cgst', 'sgst', 'igst',
      'bill no', 'invoice no', 'challan',
      // Hindi
      'बिल', 'चालान', 'कर बीजक',
      // Telugu
      'బిల్లు', 'ఇన్వాయిస్',
      // Tamil
      'பில்', 'விலைப்பட்டியல்',
    ];

    // Receipt indicators
    const receiptKeywords = [
      'receipt', 'received with thanks', 'payment received',
      'cash memo', 'cash receipt', 'raseed',
      'रसीद', 'प्राप्ति',
    ];

    // Business card indicators
    const cardKeywords = [
      'mobile', 'email', 'tel', 'fax', 'www.',
      '@', '.com', '.in', 'director', 'proprietor',
      'manager', 'owner', 'ceo', 'founder',
    ];
    const isSmallText = text.length < 500;  // Cards have little text

    // Bank statement indicators
    const bankKeywords = [
      'statement of account', 'bank statement',
      'opening balance', 'closing balance',
      'transaction history', 'account summary',
      'ifsc', 'account no',
    ];

    // Price list indicators
    const priceListKeywords = [
      'price list', 'rate list', 'rate card',
      'mrp', 'dealer price', 'retail price',
      'दर सूची', 'रेट लिस्ट',
    ];

    // Stock register indicators
    const stockKeywords = [
      'stock register', 'inventory', 'stock list',
      'opening stock', 'closing stock',
      'स्टॉक', 'माल',
    ];

    // Score each category
    const scores = {
      invoice: this.score(text, invoiceKeywords),
      receipt: this.score(text, receiptKeywords),
      business_card: this.score(text, cardKeywords) + (isSmallText ? 2 : 0),
      bank_statement: this.score(text, bankKeywords) + (hasTables ? 2 : 0),
      price_list: this.score(text, priceListKeywords) + (hasTables ? 1 : 0),
      stock_register: this.score(text, stockKeywords),
      handwritten_note: 0,  // fallback detected by Sarvam metadata
    };

    // Check if Sarvam flagged it as handwritten
    if (extracted.metadata?.is_handwritten) {
      scores.handwritten_note = 5;
    }

    // Return highest scoring type, or 'unknown' if all scores are 0
    const best = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'unknown';
  }

  score(text, keywords) {
    return keywords.filter(kw => text.includes(kw)).length;
  }
}
```

#### `gateway/documents/doc-parser.js`
Parses Sarvam Vision structured output into business objects.

```javascript
class DocParser {
  /**
   * Parse Sarvam Vision JSON output into business-usable structures.
   *
   * Sarvam returns structured markdown/HTML/JSON with:
   * - Extracted text blocks with reading order
   * - Tables as structured HTML or markdown
   * - Page-level metadata
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

  parseBankStatement(extracted) {
    // Bank statements are table-heavy
    // Sarvam extracts tables as structured data
    const tables = extracted.tables || [];
    const transactions = [];

    for (const table of tables) {
      for (const row of table.rows || []) {
        const txn = this.parseBankRow(row, table.headers);
        if (txn && txn.amount) transactions.push(txn);
      }
    }
    return transactions;
  }

  parsePriceList(extracted) {
    const tables = extracted.tables || [];
    const items = [];

    for (const table of tables) {
      for (const row of table.rows || []) {
        const item = this.parsePriceRow(row, table.headers);
        if (item && item.name) items.push(item);
      }
    }
    return items;
  }

  parseStockRegister(extracted) {
    const tables = extracted.tables || [];
    const items = [];

    for (const table of tables) {
      for (const row of table.rows || []) {
        const item = this.parseStockRow(row, table.headers);
        if (item && item.name) items.push(item);
      }
    }
    return items;
  }

  // --- Helper extractors ---

  extractPhone(text) {
    // Indian phone: +91, 0-prefixed, or plain 10 digits
    const match = text.match(/(?:\+91[\s-]?|0)?([6-9]\d{9})/);
    return match ? '+91' + match[1] : null;
  }

  extractEmail(text) {
    const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[0] : null;
  }

  extractGSTIN(text) {
    // GSTIN format: 2-digit state + 10-char PAN + 1 entity + Z + checksum
    const match = text.match(/\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]\d/);
    return match ? match[0] : null;
  }

  extractAmounts(text) {
    // Match ₹ amounts, Rs amounts, or plain numbers near currency context
    const amounts = [];
    const regex = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      amounts.push(parseFloat(match[1].replace(/,/g, '')));
    }
    return amounts;
  }

  extractDate(text) {
    // Common Indian date formats
    const patterns = [
      /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/,  // DD/MM/YYYY
      /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/,  // YYYY/MM/DD
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  }
}
```

#### `gateway/documents/invoice-extractor.js`
Specialized invoice/receipt field extraction.

```javascript
class InvoiceExtractor {
  /**
   * Extract structured invoice data from Sarvam Vision output.
   *
   * Handles:
   * - GST tax invoices (formal, with GSTIN, HSN codes)
   * - Cash memos / kachha bills (informal, handwritten or thermal print)
   * - Platform receipts (Swiggy/Zomato/Amazon seller statements)
   * - Mixed-language invoices (English headers, Hindi items)
   */

  extract(sarvamOutput) {
    const text = sarvamOutput.text || '';
    const tables = sarvamOutput.tables || [];
    const parser = new DocParser();

    const invoice = {
      vendor: this.extractVendor(text),
      invoice_number: this.extractInvoiceNumber(text),
      date: parser.extractDate(text),
      gstin: parser.extractGSTIN(text),
      items: this.extractLineItems(tables, text),
      subtotal: null,
      gst: null,
      total: null,
      payment_terms: this.extractPaymentTerms(text),
    };

    // Calculate totals from items if not explicitly found
    if (invoice.items.length > 0) {
      invoice.subtotal = invoice.items.reduce((s, i) => s + (i.amount || 0), 0);
    }

    // Extract explicit totals from text
    const totals = this.extractTotals(text);
    invoice.total = totals.total || invoice.subtotal;
    invoice.gst = totals.gst || null;

    // If we have a total and subtotal, derive GST
    if (invoice.total && invoice.subtotal && !invoice.gst) {
      const diff = invoice.total - invoice.subtotal;
      if (diff > 0) invoice.gst = diff;
    }

    return invoice;
  }

  extractVendor(text) {
    // First line or prominent text is usually vendor name
    // Look for patterns: before GSTIN, before "Tax Invoice", top of document
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      // First non-empty line that isn't a keyword
      for (const line of lines.slice(0, 5)) {
        const clean = line.trim();
        if (clean.length > 2 && clean.length < 100 &&
            !clean.match(/^(tax invoice|invoice|bill|receipt|date|gstin)/i)) {
          return clean;
        }
      }
    }
    return null;
  }

  extractInvoiceNumber(text) {
    const patterns = [
      /(?:invoice|bill|receipt|memo|challan)\s*(?:no|number|#)[.:=\s]*([A-Z0-9\-\/]+)/i,
      /(?:inv|bill)\s*[.:=\s]*([A-Z0-9\-\/]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

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

      for (const row of table.rows || []) {
        const cells = row.cells || row;
        items.push({
          name: cells[nameIdx] || cells[0] || '',
          quantity: parseFloat(cells[qtyIdx]) || 1,
          rate: parseFloat((cells[rateIdx] || '').replace(/[₹,]/g, '')) || null,
          amount: parseFloat((cells[amtIdx] || '').replace(/[₹,]/g, '')) || null,
          hsn: this.extractHSN(cells),
        });
      }
    }

    // If no tables, try to parse from text (informal bills)
    if (items.length === 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(
          /(.+?)\s+(\d+)\s*[×xX]\s*₹?([\d,]+)\s*=?\s*₹?([\d,]+)/
        );
        if (match) {
          items.push({
            name: match[1].trim(),
            quantity: parseInt(match[2]),
            rate: parseFloat(match[3].replace(/,/g, '')),
            amount: parseFloat(match[4].replace(/,/g, '')),
          });
        }
      }
    }

    return items;
  }

  extractTotals(text) {
    const result = { subtotal: null, gst: null, total: null };
    const lower = text.toLowerCase();

    // Total / Grand Total
    const totalMatch = lower.match(
      /(?:grand\s*total|total\s*amount|net\s*amount|total)[:\s₹]*([\d,]+(?:\.\d{2})?)/
    );
    if (totalMatch) result.total = parseFloat(totalMatch[1].replace(/,/g, ''));

    // GST amounts
    const gstMatch = lower.match(
      /(?:cgst\s*\+?\s*sgst|total\s*tax|gst\s*amount|tax)[:\s₹]*([\d,]+(?:\.\d{2})?)/
    );
    if (gstMatch) result.gst = parseFloat(gstMatch[1].replace(/,/g, ''));

    return result;
  }

  extractHSN(cells) {
    for (const cell of cells) {
      const match = String(cell).match(/\b\d{4,8}\b/);
      if (match && match[0].length >= 4) return match[0];
    }
    return null;
  }

  extractPaymentTerms(text) {
    const match = text.match(
      /(?:payment|due|terms)[:\s]*(net\s*\d+|immediate|on\s*delivery|cod|\d+\s*days?)/i
    );
    return match ? match[1].trim() : null;
  }
}
```

### MODIFIED FILES

#### `gateway/sarvam/sarvam-client.js` — Add Document Intelligence

Add these methods to the existing Sarvam client:

```javascript
// Add to existing SarvamClient class:

/**
 * Process a document through Sarvam Vision Document Intelligence
 * Handles the full async job lifecycle
 *
 * @param {string} filePath - Path to image/PDF file
 * @param {Object} options - {language: 'en-IN', outputFormat: 'json'}
 * @returns {Object} Extracted document data
 */
async processDocument(filePath, options = {}) {
  const language = options.language || 'en-IN';
  const outputFormat = options.outputFormat || 'json';

  // 1. Create job
  const job = await this.createDocJob(language, outputFormat);
  const jobId = job.job_id;

  // 2. Get upload URL
  const uploadInfo = await this.getUploadUrl(jobId);

  // 3. Upload file
  await this.uploadFile(uploadInfo.upload_url, filePath);

  // 4. Start processing
  await this.startDocJob(jobId);

  // 5. Poll until complete (timeout: 60 seconds)
  const status = await this.pollJobStatus(jobId, 60000);

  if (status.job_state !== 'Completed' &&
      status.job_state !== 'PartiallyCompleted') {
    throw new Error(`Document processing failed: ${status.job_state}`);
  }

  // 6. Download and parse output
  const output = await this.downloadJobOutput(jobId);
  return output;
}

async createDocJob(language, outputFormat) {
  const response = await fetch(
    `${this.baseUrl}/doc-digitization/job/v1`, {
    method: 'POST',
    headers: {
      'API-Subscription-Key': this.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_parameters: {
        language: language,
        output_format: outputFormat,
      }
    }),
  });
  return response.json();
}

async getUploadUrl(jobId) {
  const response = await fetch(
    `${this.baseUrl}/doc-digitization/upload/${jobId}`, {
    method: 'GET',
    headers: { 'API-Subscription-Key': this.apiKey },
  });
  return response.json();
}

async uploadFile(uploadUrl, filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const contentType = filePath.endsWith('.pdf')
    ? 'application/pdf'
    : 'image/jpeg';
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: fileBuffer,
  });
}

async startDocJob(jobId) {
  await fetch(
    `${this.baseUrl}/doc-digitization/start/${jobId}`, {
    method: 'POST',
    headers: { 'API-Subscription-Key': this.apiKey },
  });
}

async pollJobStatus(jobId, timeoutMs = 60000) {
  const startTime = Date.now();
  const pollInterval = 1000;  // 1 second

  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(
      `${this.baseUrl}/doc-digitization/status/${jobId}`, {
      headers: { 'API-Subscription-Key': this.apiKey },
    });
    const status = await response.json();

    if (['Completed', 'PartiallyCompleted', 'Failed'].includes(status.job_state)) {
      return status;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error('Document processing timed out');
}

async downloadJobOutput(jobId) {
  const response = await fetch(
    `${this.baseUrl}/doc-digitization/download/${jobId}`, {
    headers: { 'API-Subscription-Key': this.apiKey },
  });
  // Returns ZIP — extract and parse
  const zipBuffer = await response.buffer();
  return this.parseDocOutput(zipBuffer);
}

parseDocOutput(zipBuffer) {
  // Extract ZIP, parse JSON/MD/HTML content
  // Returns structured object with text, tables, metadata
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const result = { text: '', tables: [], pages: [], metadata: {} };

  for (const entry of entries) {
    const content = entry.getData().toString('utf8');
    const name = entry.entryName;

    if (name.endsWith('.json')) {
      const parsed = JSON.parse(content);
      Object.assign(result, parsed);
    } else if (name.endsWith('.md')) {
      result.text += content + '\n';
      result.tables.push(...this.extractTablesFromMd(content));
    } else if (name.endsWith('.html')) {
      result.text += this.stripHtml(content);
      result.tables.push(...this.extractTablesFromHtml(content));
    }
  }
  return result;
}
```

#### `gateway/sarvam/sarvam-config.json` — Add Document Settings

```diff
+ "document_intelligence": {
+   "enabled": true,
+   "default_output_format": "json",
+   "job_timeout_ms": 60000,
+   "max_file_size_mb": 20,
+   "supported_formats": ["jpg", "jpeg", "png", "pdf"],
+   "auto_classify": true,
+   "confirm_before_logging": true,
+   "temp_dir": "/tmp/dhandhaphone-docs"
+ }
```

#### `gateway/index.js` — Route Photo/Document Messages

```diff
+ const { DocHandler } = require('./documents/doc-handler');

+ const docHandler = new DocHandler(sarvam, agent);

  bot.on('message', async (msg) => {
    // Voice message handling
    if (msg.voice || msg.audio) {
      await voiceHandler.handleVoiceMessage(msg);
      return;
    }

+   // Photo / document handling
+   if (msg.photo || msg.document) {
+     // msg.photo = array of PhotoSize objects (pick largest)
+     // msg.document = file with mime_type
+     const isDocument = msg.document &&
+       ['application/pdf', 'image/jpeg', 'image/png']
+         .includes(msg.document.mime_type);
+     const isPhoto = msg.photo && msg.photo.length > 0;
+
+     if (isPhoto || isDocument) {
+       await docHandler.handleDocument(msg);
+       return;
+     }
+   }

    // Existing text message handling...
  });
```

#### `config/SOUL.md` — Document Processing Behavior

Add after the Voice Behavior section:

```markdown
## Document Processing Behavior

When the owner sends a photo or PDF:
1. Acknowledge immediately: "📄 Reading the document..."
2. Process through Sarvam Vision (no LLM cost for OCR)
3. Classify the document type automatically
4. Show what was extracted and ask for confirmation before logging

Document types you understand:
- **Invoice / Bill** → Extract vendor, items, amounts, GST → log as debit
- **Receipt** → Extract payer, amount, date → log as credit
- **Business card** → Extract name, phone, company → save as contact
- **Bank statement** → Extract transactions → batch import to ledger
- **Price list** → Extract items and rates → update price tracking
- **Handwritten note** → Read the text → process as if owner typed it
- **Stock register** → Extract items and quantities → update inventory
- **Unknown** → Show extracted text, ask owner what to do

Rules:
- ALWAYS confirm before logging financial data from documents
- Show a clean summary, not raw OCR output
- If extraction seems wrong (low confidence), say so:
  "Some parts weren't clear. Here's what I could read: ..."
- Never fabricate data that wasn't in the document
- For invoices: extract GST details when present (useful at filing time)
- Store original photo path in transaction notes for reference
```

#### `skills/business-brain/SKILL.md` — Replace Photo Handling

Replace the existing "Document Processing" section:

```markdown
### Document Processing (when owner sends photos)

IMPORTANT: Document OCR is handled by Sarvam Vision via the
doc-handler module. Do NOT use LLM vision to read documents.

When the doc-handler extracts data from a photo:
1. It classifies the document and extracts structured fields
2. It shows the extraction to the owner for confirmation
3. After confirmation, YOU handle the business logic:
   - Invoice → log debit in ledger, update supplier contact
   - Receipt → log credit in ledger, update customer contact
   - Business card → create/update contact
   - Price list → update workspace/prices/
   - Stock sheet → update workspace/inventory/

If the doc-handler can't classify the document, it passes the
extracted text to you. Treat it as a normal text message and
figure out what the owner needs from the content.

For non-document photos (shop photos, selfies, random images):
These don't go through Sarvam Vision. The agent can note them
or ignore them as appropriate.
```

#### `skills/money-tracker/SKILL.md` — OCR Source Type

Add to the "Manual Entry" section:

```markdown
## OCR-Captured Transactions

When a transaction arrives with source: "ocr", it was extracted
from a photographed document by Sarvam Vision. Extra fields:
- `ocr_document_type`: "invoice", "receipt", "bank_statement"
- `ocr_vendor`: vendor name as read from document
- `ocr_invoice_no`: invoice number if present
- `ocr_items`: array of line items if present
- `notes`: includes reference to original photo

These transactions have already been confirmed by the owner
(doc-handler asks ✅/❌ before logging). Treat them as reliable.

For bank statement imports (multiple transactions at once):
- Each transaction gets a separate ledger entry
- All share the same `batch_id` for reference
- Dedup against existing SMS-captured transactions
  (same amount + same date + same counterparty = skip)
```

---

## Telegram Integration: Handling Photos

### Receiving Photos
Telegram sends photos as an array of PhotoSize objects (same
image at different resolutions). We pick the largest.

```javascript
// In doc-handler.js
async downloadFromTelegram(message) {
  let fileId;

  if (message.photo) {
    // Pick highest resolution (last in array)
    const largest = message.photo[message.photo.length - 1];
    fileId = largest.file_id;
  } else if (message.document) {
    fileId = message.document.file_id;
  }

  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  const buffer = await response.buffer();

  // Save to temp directory
  const ext = file.file_path.split('.').pop() || 'jpg';
  const tempPath = `/tmp/dhandhaphone-docs/${Date.now()}.${ext}`;
  fs.mkdirSync('/tmp/dhandhaphone-docs', { recursive: true });
  fs.writeFileSync(tempPath, buffer);

  return tempPath;
}
```

### Photo with Caption
If the owner sends a photo WITH a caption, the caption provides
context for what the document is:

```
Photo + "supplier bill" → classify as invoice/debit
Photo + "payment receipt" → classify as receipt/credit
Photo + "Menon's card" → classify as business card
Photo + no caption → auto-classify from content
```

```javascript
// In handleDocument():
if (message.caption) {
  // Use caption as classification hint
  const hint = message.caption.toLowerCase();
  if (hint.match(/bill|invoice|supplier|khareed/)) docType = 'invoice';
  else if (hint.match(/receipt|payment|raseed/)) docType = 'receipt';
  else if (hint.match(/card|visiting/)) docType = 'business_card';
  // Override auto-classification with owner's intent
}
```

---

## Dependencies

### npm packages (add to gateway/package.json)
```json
{
  "adm-zip": "^0.5.10"
}
```

adm-zip is needed to extract the ZIP files that Sarvam Vision
returns. Lightweight, no native dependencies, works in Termux.

### Termux — no additional dependencies
Sarvam Vision is cloud-only (no edge model for OCR). All processing
happens via API. No ffmpeg or extra tools needed for documents.

---

## Cost Analysis

### February 2026: FREE
All Document Intelligence APIs are free for the entire month.
Test everything at zero cost.

### After February:
- Free tier: 100 pages/month (enough for light testing)
- Pay-as-you-go: estimated ~₹0.60/page (from Sarvam credit system)
- Pro plan: ₹2,999/month for 5,000 pages

### DhandhaPhone Usage Estimate
A typical small business owner might photograph:
- 2-3 invoices per day → ~75/month
- 1-2 receipts per day → ~45/month
- 1 bank statement per month → ~5 pages
- Occasional business cards → ~5/month

**Total: ~130 pages/month**
- Free tier covers light users (100 pages)
- Active users: ~₹78/month at ₹0.60/page
- Combined with voice (₹255/month): total ~₹333/month per user

---

## Implementation Schedule

### Week 1 (alongside voice Week 2)

**Day 1: API Validation**
- [ ] Test Document Intelligence API with Sarvam dashboard
- [ ] Upload a sample Indian invoice (Hindi or English)
- [ ] Verify structured output: text, tables, reading order
- [ ] Test with Telugu, Tamil, Kannada documents
- [ ] Test with a handwritten note
- [ ] Test with a thermal-printed kachha bill (low quality)
- [ ] Measure processing time per document type

**Day 2: Sarvam Client Extension**
- [ ] Add processDocument() to sarvam-client.js
- [ ] Implement full job lifecycle (create → upload → start → poll → download)
- [ ] Parse ZIP output into structured objects
- [ ] Unit test on Mac with sample documents

**Day 3: Document Pipeline**
- [ ] Create doc-handler.js with Telegram integration
- [ ] Create doc-classifier.js with keyword-based classification
- [ ] Create doc-parser.js with field extractors
- [ ] Create invoice-extractor.js
- [ ] Test full pipeline on Mac: photo → extract → classify → structured data

**Day 4: Business Logic Integration**
- [ ] Wire doc-handler into index.js (photo message routing)
- [ ] Update business-brain skill (replace LLM vision with Sarvam Vision)
- [ ] Update money-tracker (handle source=ocr with OCR fields)
- [ ] Update SOUL.md with document processing behavior
- [ ] Add confirmation flow (✅/❌ before logging)

**Day 5: Phone Testing**
- [ ] Deploy to phone alongside voice module
- [ ] Test: photograph a real invoice → verify extraction
- [ ] Test: photograph a handwritten note → verify text extraction
- [ ] Test: photograph a business card → verify contact creation
- [ ] Test: send PDF of bank statement → verify transaction import
- [ ] Test mixed-language documents (English headers, Hindi items)
- [ ] Test low-quality photos (angled, shadowed, crumpled)

---

## Testing Additions

Add these to the existing testing plan (Part 7: Business Brain):

### T-DOC-01: Invoice Photo (English)
```
Action: Photograph an English invoice and send to bot
Expected:
  - "📄 Reading the document..."
  - Shows: vendor, items, total, GST
  - Asks for confirmation before logging
Verify:
  [ ] Vendor name correct
  [ ] Total amount correct
  [ ] Line items extracted
  [ ] GST amount extracted (if present)
  [ ] Confirmation asked before ledger entry
```

### T-DOC-02: Invoice Photo (Hindi/Regional)
```
Action: Photograph a Hindi or Telugu invoice
Verify:
  [ ] Indian language text extracted correctly
  [ ] Amount parsed correctly (₹ or Rs format)
  [ ] Vendor name in original script preserved
```

### T-DOC-03: Kachha Bill (Thermal Print)
```
Action: Photograph a small thermal-printed bill (shop receipt)
Verify:
  [ ] Text readable despite low contrast
  [ ] Total amount extracted
  [ ] Classified as receipt, not invoice
```

### T-DOC-04: Handwritten Note
```
Action: Write daily accounts on paper, photograph it
  "Rice - 10 bags - 24000
   Oil - 5 cans - 3500
   Cash collected - 15000"
Verify:
  [ ] Handwritten text extracted
  [ ] Numbers correctly parsed
  [ ] Passed to agent for interpretation
```

### T-DOC-05: Business Card
```
Action: Photograph a business card
Verify:
  [ ] Name extracted
  [ ] Phone number extracted
  [ ] Company name extracted
  [ ] Contact created after confirmation
```

### T-DOC-06: Bank Statement PDF
```
Action: Send a PDF bank statement via Telegram
Verify:
  [ ] Multi-page document processed
  [ ] Transactions extracted from table
  [ ] Credits and debits correctly identified
  [ ] Import confirmation shown with totals
  [ ] Dedup against existing SMS entries
```

### T-DOC-07: Price List
```
Action: Photograph a supplier's price list
Verify:
  [ ] Items and prices extracted from table
  [ ] Price update confirmation shown
  [ ] Prices stored in workspace/prices/
```

### T-DOC-08: Photo with Caption
```
Action: Send invoice photo with caption "supplier bill from Lakshmi Traders"
Verify:
  [ ] Caption used to help classify (invoice/debit)
  [ ] Vendor name from caption matches extraction
```

### T-DOC-09: Blurry / Angled Photo
```
Action: Send a poorly-taken photo (angled, blurry, shadowed)
Verify:
  [ ] Handles gracefully — extracts what it can
  [ ] If unreadable: "Some parts weren't clear..."
  [ ] No crash or timeout
```

### T-DOC-10: Mixed-Language Document
```
Action: Invoice with English headers + Hindi/Tamil item descriptions
Verify:
  [ ] Both languages extracted
  [ ] Table structure preserved
  [ ] Items correctly associated with amounts
```

### T-DOC-11: Non-Document Photo
```
Action: Send a selfie or shop photo (not a document)
Expected:
  - Should NOT be processed through Sarvam Vision
  - Agent can respond conversationally
Verify:
  [ ] Not sent to document API
  [ ] No error or irrelevant extraction
```

---

## What Comes Later

### Phase 1.5: Smart Document Memory
- Store extracted invoices in `workspace/documents/`
- Build supplier invoice history
- "Show me all invoices from Krishna Traders this month"
- Auto-detect price changes across invoices from same supplier

### Phase 2: GST Filing Prep
- Aggregate all invoice data with GSTIN numbers
- Generate GSTR-1 compatible data export
- "Mere CA ko GST data bhej do" → formatted CSV/JSON

### Phase 3: Inventory Auto-Sync
- Invoice line items auto-update inventory quantities
- Purchase invoice → stock increases
- Sale receipts → stock decreases
- "When I photograph a purchase bill, inventory updates automatically"
