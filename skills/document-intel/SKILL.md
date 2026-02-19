---
name: document-intel
description: >
  Processes photos of invoices, bills, receipts, and handwritten notes
  sent via Telegram using Sarvam Vision Document Intelligence API.
  Extracts key data (amounts, dates, party names, line items, GST numbers)
  and updates ledger, contacts, and inventory. Use when user sends a
  photo, image, document, invoice, bill, receipt, or PDF.
metadata:
  openclaw:
    emoji: "\uD83D\uDCF8"
---

# Document Intelligence

## What This Skill Does
Processes photos and PDFs sent by the business owner via Telegram.
Uses Sarvam Vision's Document Intelligence API for OCR and structured
extraction. Automatically classifies documents and extracts business data.

IMPORTANT: Document OCR is handled by Sarvam Vision via the doc-handler
module (`workspace/lib/documents/doc-handler.js`). Do NOT use LLM vision
to read documents — Sarvam Vision is faster, cheaper, and better at
Indian languages and scripts.

## Supported Document Types
1. **Printed invoices** — supplier bills, purchase orders, GST invoices
2. **Handwritten bills** — kachha bills, manual invoices
3. **Receipts** — payment receipts, cash memos
4. **Price lists** — supplier rate cards
5. **Delivery challans** — goods delivery notes
6. **Bank statements** — monthly statements (photos or PDF)
7. **Visiting cards** — contact information extraction
8. **Stock registers** — inventory records

## How Document Processing Works

### Pipeline (handled by doc-handler.js)
```
Owner sends photo/PDF via Telegram
       |
1. Download from Telegram (pick highest resolution)
2. Send to Sarvam Vision Document Intelligence API
   (async job: create -> upload -> start -> poll -> download)
3. Parse structured output (ZIP with JSON/MD/HTML)
4. Classify document type (keyword matching + caption hints)
5. Extract relevant fields per document type
6. Present summary to owner for confirmation
7. After confirmation, update workspace files
```

### Step 1: Sarvam Vision handles OCR
The doc-handler sends the image/PDF to Sarvam Vision and receives
structured output: text blocks in reading order, tables as structured
data, page-level metadata (including handwriting detection).

### Step 2: Auto-classification
The doc-classifier scores extracted text against keyword lists:
- Invoice keywords: "invoice", "bill", "tax invoice", "GSTIN", "HSN"
- Receipt keywords: "receipt", "received with thanks", "raseed"
- Business card: "mobile", "email", "director", "proprietor"
- Bank statement: "statement of account", "opening balance", "IFSC"
- etc.

If the owner sends a caption with the photo, that overrides auto-classification:
- Photo + "supplier bill" → classify as invoice
- Photo + "payment receipt" → classify as receipt
- Photo + "Menon's card" → classify as business card
- Photo + no caption → auto-classify from content

### Step 3: Field extraction
For **invoices/bills** (invoice-extractor.js):
- Vendor name, invoice number, date
- Line items: product, quantity, rate, amount, HSN code
- Subtotal, GST (CGST/SGST/IGST), grand total
- GSTIN, payment terms

For **receipts**: Same as invoice but logged as credit

For **visiting cards** (doc-parser.js):
- Name, designation, company
- Phone, email, address

For **bank statements**: Rows extracted from tables
- Date, description, debit, credit, balance

For **price lists**: Items and prices from tables

### Step 4: Confirmation (MANDATORY for financial data)
The doc-handler shows extracted data and asks owner to confirm:
```
Read the invoice:
From: Krishna Traders
Items: Rice 25kg x 10, Oil 5L x 20 +2 more
Total: ₹52,400 (incl GST ₹4,400)
Date: 17/02/2026
Invoice #: INV-2026-0142

Log as debit? ✅ / ❌
```

### Step 5: After confirmation, YOU handle business logic

**Preferred: Use SQLite DB** via `getDB()` from `workspace/lib/utils.js`:
- **Invoice** → `db.addTransaction({ type: 'debit', source: 'ocr', ... })`, `db.addDocument(...)`, update supplier contact
- **Receipt** → `db.addTransaction({ type: 'credit', source: 'ocr', ... })`, `db.addDocument(...)`, update customer contact
- **Business card** → `db.addContact({ name, phone, company, type })`
- **Price list** → `db.addPriceEntry({ item_name, price, unit, source: 'price_list' })`
- **Bank statement** → batch import via `db.addTransaction()` with shared `batch_id`, use `db.isDuplicate()` to skip SMS-captured entries
- **Stock register** → `db.addInventoryItem()` or `db.updateInventoryQuantity()`

Also log the document: `db.addDocument({ type, file_path, raw_text, structured_data, language, confidence })`

**Flat file fallback** (also written for dual-write):
- **Invoice** → log debit in ledger (source: "ocr"), update supplier contact
- **Receipt** → log credit in ledger (source: "ocr"), update customer contact
- **Business card** → create/update contact in contacts.json
- **Price list** → update inventory/margins.json or price history
- **Bank statement** → batch import to ledger, dedup against SMS entries
- **Stock register** → update inventory/stock.json

If the doc-handler can't classify the document, it passes the
extracted text to you. Treat it as a normal text message and figure
out what the owner needs from the content.

## Language Handling
- Sarvam Vision supports 23 Indian languages and all major scripts
- Mixed-language documents (English headers + Hindi items) are handled natively
- GST invoices are usually English
- Kachha bills may be in any Indian language
- The API auto-detects the document language

## Non-Document Photos
For non-document photos (shop photos, selfies, random images),
these should NOT go through Sarvam Vision. The agent can note them
or ignore them as appropriate.

## Error Handling (respond in owner's language)
- If image is blurry: "Could not read the document clearly. Please try a clearer photo."
- If partial extraction: Show what was extracted, ask for missing info
- Never make up numbers — if amount isn't clear, ask
- If Sarvam API fails: Fall back to asking owner to type the details

## Examples

**User sends photo of a GST invoice**
```
Read the invoice:
From: Gupta Suppliers
Items: Cement 50 bags x ₹380, TMT 10mm 20 pcs x ₹550
Total: ₹35,400 (incl GST ₹5,400)
Date: 17 Feb 2026
Payment due: 15 days

Log as debit? ✅ / ❌
```
After ✅: "Got it — ₹35,400 debit logged. Gupta Suppliers contact updated."

**User sends photo of a business card**
```
Business card:
Rajesh Menon — Menon Electronics
Proprietor
Phone: +919876543210
Email: rajesh@menonelec.com

Save as contact? ✅ / ❌
```

**User sends photo of a handwritten note**
(Extracted text passed to agent for natural processing)
Response: "Got it — Rice 10 bags ₹24,000, Oil 5 cans ₹3,500. Cash collected ₹15,000. Logged."

**User sends blurry photo**
"Some parts of the document weren't clear. Here's what I could read:
[partial extraction]. Can you fill in the missing details?"
