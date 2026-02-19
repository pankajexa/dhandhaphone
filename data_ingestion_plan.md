# DhandhaPhone — Data Ingestion Plan

How business data flows into the system across every channel.

---

## The Problem

DhandhaPhone's Business Brain is only as smart as the data it receives.
We have a sophisticated property graph, anomaly detection, pattern
recognition, and a reasoning pipeline — all of which are worthless if
the owner's transactions don't make it into the database.

The reality for Indian SMBs:

- Cash is still 40-60% of transactions for most small businesses.
  Cash has zero digital trail. The only way to capture it is the
  owner telling us.
- UPI is dominant for digital payments, but SMS notifications from
  banks are unreliable — DND blocks, carrier delays, some banks
  skip SMS for small amounts (HDFC skips UPI debits under ₹100,
  SBI skips credits for some UPI handles).
- App notifications (GPay, PhonePe, Paytm) are the most reliable
  digital signal — they always fire on successful UPI transactions.
  But we only parse 3 of 13 documented apps.
- Paper receipts, supplier bills, and bahi-khata pages are still
  the primary record for many businesses. Photo capture + OCR is
  the bridge.
- Owners don't have time for careful data entry. Every extra step
  is friction they'll skip. The system needs to capture data with
  minimum owner effort.

The goal: achieve 90%+ transaction capture rate through a combination
of automatic channels (SMS, notifications) and low-friction manual
channels (voice, photo). No single channel is reliable enough alone.

---

## The Seven Channels

```
┌─────────────────────────────────────────────────────────┐
│                    DATA INGESTION                        │
│                                                          │
│  AUTOMATIC (zero owner effort)                           │
│  ┌─────────────┐  ┌──────────────────┐                   │
│  │ 1. SMS      │  │ 2. Notifications │                   │
│  │   Parsing   │  │    Listener      │                   │
│  │ (built)     │  │  (partially      │                   │
│  │             │  │   built)         │                   │
│  └──────┬──────┘  └────────┬─────────┘                   │
│         │                  │                             │
│         ▼                  ▼                             │
│  ┌──────────────────────────────────────┐                │
│  │         CROSS-CHANNEL DEDUP          │                │
│  │     (hash-based + ref_id match)      │                │
│  └──────────────────┬───────────────────┘                │
│                     │                                    │
│  LOW-FRICTION (minimal owner effort)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ 3. Voice │ │ 4. Photo │ │ 5. Fwd   │                 │
│  │ (built)  │ │ OCR      │ │ Messages │                 │
│  │          │ │ (built)  │ │ (new)    │                 │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                 │
│       │            │            │                        │
│  PERIODIC (owner does at end of day or week)             │
│  ┌────────────────┐  ┌─────────────────┐                 │
│  │ 6. End-of-Day  │  │ 7. Bulk Import  │                 │
│  │  Reconciliation│  │  (statements,   │                 │
│  │  (new)         │  │   passbook)     │                 │
│  └───────┬────────┘  └───────┬─────────┘                 │
│          │                   │                           │
│          ▼                   ▼                           │
│  ┌──────────────────────────────────────┐                │
│  │           transactions TABLE          │                │
│  │           dedup_log TABLE             │                │
│  └──────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### Channel 1: SMS Parsing (Built)

**Status:** Fully implemented in sms-poller.js.

**How it works:** Every 5 minutes (heartbeat), `termux-sms-list` reads
new SMS from the phone's inbox. Each message is matched against bank
SMS patterns (SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Canara, Union,
IndusInd, Federal, and generic patterns). Matched messages are parsed
into transactions and written to the database.

**What it captures:** Bank-originated transaction alerts — credits,
debits, UPI, NEFT, IMPS, ATM withdrawals, POS swipes.

**Known gaps:**
- SBI skips credit SMS for some UPI handles (@paytm, @ybl)
- HDFC skips SMS for small UPI (debit <₹100, credit <₹500)
- DND (Do Not Disturb) can block transactional SMS on some carriers
  even though TRAI exempts transactional SMS — carrier enforcement
  is inconsistent
- Dual SIM phones: Termux reads SMS from both SIMs, but the
  business-relevant SIM might not be the default data SIM, causing
  missed permissions
- Some banks batch SMS during high-volume periods (festival sales,
  month-end salary disbursements), delivering hours late

**Confidence score:** 0.85 — SMS parsing is well-tested but not perfect.
Bank formats change without notice, and regex can miss edge cases.

**No changes needed** — this channel works. The notification listener
(Channel 2) fills the gaps SMS misses.

---

### Channel 2: Notification Listener (Partially Built — Needs Completion)

**Status:** Basic plumbing exists. Three parsers (GPay, PhonePe, Paytm).
No dedicated poller. Piggybacking on SMS poller. 10 of 13 documented
apps missing. Weak dedup. No tests.

**This is the highest-priority gap in the entire system.** App
notifications are the most reliable signal for UPI transactions — they
always fire, they're never blocked by DND, and they often contain
structured data (amount, counterparty, UPI ref) that SMS doesn't.

Full implementation plan follows in the dedicated section below.

---

### Channel 3: Voice (Built)

**Status:** Fully implemented via Sarvam STT (11 languages).

**How it works:** Owner sends a voice message to the Telegram bot.
Sarvam STT transcribes it. The agent extracts transaction details
(amount, direction, counterparty, method) and logs it.

**What it captures:** Cash transactions (the biggest blind spot for
automatic channels), off-record payments, adjustments, and any
transaction the owner wants to log manually.

**Examples across languages:**
- Hindi: "Sharma ji ne paanch hazaar cash diye"
- Telugu: "Krishna Traders nundi rice vachindi, padhihenu velu"
- Tamil: "Raju kitta rendu aayiram cash kuduthen"
- Kannada: "Suresh inda mooru saavira UPI bandu"
- Bengali: "Gopal babu ke ponero hajar diyechi rent-er jonne"
- English: "Received 8000 from Mehta, UPI"

**Confidence score:** 0.70 — voice has inherent ambiguity. Numbers
can be misheard. The pre-action middleware in the brain architecture
catches most errors by requiring confirmation for large amounts.

**Enhancement needed:** When the notification listener catches a UPI
transaction AND the owner also mentions it by voice, the system should
reconcile them and not double-count. This is handled by cross-channel
dedup (see below).

---

### Channel 4: Photo/OCR (Built)

**Status:** Sarvam Vision OCR integrated for document processing.
Document intelligence pipeline covers receipts, invoices, bills.

**How it works:** Owner photographs a document and sends it to the
Telegram bot. Sarvam Vision OCR extracts text. The agent parses
structured data depending on document type:
- **Receipt/bill:** Amount, items, vendor, date, GST if present
- **Bank passbook page:** Multiple transactions (date, description,
  credit/debit, balance) — batch ingested
- **Bahi-khata page:** Handwritten ledger — OCR extracts names and
  amounts, agent asks owner to confirm
- **Banking app screenshot:** Amount, counterparty, UPI ref, date —
  single transaction

**What it captures:** Paper-trail transactions that no automatic
channel sees. Supplier bills (always paper for small businesses),
cash memos, and historical data from passbook/bahi-khata.

**Confidence score:** 0.60 for handwritten (bahi-khata), 0.80 for
printed receipts, 0.90 for banking app screenshots.

**Enhancement needed:** Structured extraction templates for common
document formats. Currently the OCR returns raw text and the agent
uses LLM to extract — this works but is expensive. For common formats
(HDFC passbook, SBI passbook, thermal receipt, Tally invoice), we
should have regex-first extraction with LLM fallback.

---

### Channel 5: Forwarded Messages (New)

**Status:** Not built.

**How it works:** Owner receives a transaction confirmation on WhatsApp
(many UPI apps send WhatsApp notifications), SMS from a different
phone, or email receipt. They forward it to the Telegram bot as text.
The agent parses the forwarded message exactly like it would parse an
SMS — same regex patterns, same extraction logic.

**Implementation:**

```javascript
// gateway/ingestion/forwarded-message-parser.js

function parseForwardedMessage(text) {
  // Step 1: Strip forwarding artifacts
  // WhatsApp forwards start with "---------- Forwarded message ---------"
  // Telegram forwards show "Forwarded from [name]"
  const cleanText = stripForwardingHeaders(text);

  // Step 2: Try SMS bank parsers first
  const smsResult = parseBankSMS(cleanText);
  if (smsResult) return { ...smsResult, source: 'forwarded' };

  // Step 3: Try UPI notification parsers
  const upiResult = parseUPINotification(cleanText);
  if (upiResult) return { ...upiResult, source: 'forwarded' };

  // Step 4: Try generic amount extraction
  const genericResult = extractGenericTransaction(cleanText);
  if (genericResult) return { ...genericResult, source: 'forwarded' };

  // Step 5: Can't parse — ask owner
  return null;
}

function stripForwardingHeaders(text) {
  return text
    .replace(/^-+\s*Forwarded message\s*-+\n?/im, '')
    .replace(/^From:.*\n/im, '')
    .replace(/^Date:.*\n/im, '')
    .replace(/^Subject:.*\n/im, '')
    .replace(/^Forwarded from.*\n/im, '')
    .trim();
}
```

**What it captures:** Transaction confirmations the owner receives on
channels we can't directly monitor (WhatsApp, email, SMS on a
different phone).

**Confidence score:** 0.75 — same as SMS parsing, but slightly lower
because forwarding can truncate or reformat the original message.

**Why this matters:** Many Indian UPI apps now send WhatsApp
notifications alongside (or instead of) SMS. PhonePe and GPay both
have WhatsApp notification options. If the owner enables these and
forwards them to the bot, we capture transactions that neither SMS
nor notification listener would see (because WhatsApp notifications
don't appear in `termux-notification-list` with the same structure).

---

### Channel 6: End-of-Day Reconciliation (New)

**Status:** Not built.

**How it works:** At the owner's closing time (configurable, default
9 PM), the agent sends a proactive message:

```
Hindi:   "Aaj ka hisab: ₹32,500 aaya, ₹14,200 gaya. Net ₹18,300.
          Sahi hai? Ya kuch aur hua aaj?"
Telugu:  "Ee roju lekkhalu: ₹32,500 vachindi, ₹14,200 vellindi.
          Net ₹18,300. Correct aa? Inkemaina jarigindaa?"
Tamil:   "Innaiku kanakku: ₹32,500 vanthuchu, ₹14,200 pochchu.
          Net ₹18,300. Sari-yaa? Vera enna nadanthuchu?"
English: "Today's count: ₹32,500 in, ₹14,200 out. Net ₹18,300.
          Correct? Anything else today?"
```

The owner has three response modes:

**Mode A: "Sahi hai" / "Correct"** — The agent closes the day. All
captured transactions are confirmed. The daily summary is finalized.

**Mode B: "Total 45,000 tha aaj" / "Total was 45,000 today"** — The
owner gives a different total. The agent identifies the gap
(₹45,000 - ₹32,500 = ₹12,500 missing) and asks what it is:

```
Hindi:   "₹12,500 ka gap hai. Cash mein kuch hua jo miss ho gaya?"
Telugu:  "₹12,500 difference undi. Cash lo emaina miss ayyindaa?"
```

The owner can then voice-dictate the missing transactions, or say
"haan sab cash tha" (yes it was all cash) and the agent logs a
single bulk cash entry for the difference.

**Mode C: Detailed corrections** — "Rajan ka 5000 miss hua, aur
Gupta ka 3000 cancel karo" — The agent processes each correction.

**Implementation:**

```javascript
// gateway/ingestion/eod-reconciliation.js

class EODReconciliation {
  constructor(db) {
    this.db = db;
  }

  async generateSummary(date, language) {
    const summary = this.db.getDailySummary(date);
    const template = EOD_TEMPLATES[language] || EOD_TEMPLATES.en;

    return template
      .replace('{credit_total}', formatIndianNumber(summary.total_credit))
      .replace('{debit_total}', formatIndianNumber(summary.total_debit))
      .replace('{net}', formatIndianNumber(summary.total_credit - summary.total_debit));
  }

  async processReconciliation(ownerResponse, date, language) {
    // Parse owner's response
    const intent = this.classifyResponse(ownerResponse);

    switch (intent.type) {
      case 'confirmed':
        // Mark all day's transactions as confirmed
        await this.db.confirmDayTransactions(date);
        return { action: 'closed', message: this.getClosedMessage(language) };

      case 'different_total':
        // Owner gave a different total
        const captured = this.db.getDailySummary(date);
        const gap = intent.amount - captured.total_credit;
        if (Math.abs(gap) > 0) {
          return {
            action: 'gap_found',
            gap: gap,
            message: this.getGapMessage(gap, language)
          };
        }
        break;

      case 'corrections':
        // Owner listed specific corrections
        return {
          action: 'corrections',
          corrections: intent.corrections,
          message: this.getCorrectionsAckMessage(intent.corrections, language)
        };

      case 'additional':
        // Owner dictating missed transactions
        return {
          action: 'additional',
          message: null // Let the normal voice/text processing handle it
        };
    }
  }

  classifyResponse(text) {
    const lower = text.toLowerCase();

    // Check for confirmation phrases across languages
    const confirmPhrases = [
      'sahi hai', 'correct', 'haan', 'ha', 'theek hai', 'ok',
      'sari', 'correct aa', 'ayyindi', 'aamam', 'howdu',
      'hya', 'achha', 'thik ache', 'bari', 'hau'
    ];
    if (confirmPhrases.some(p => lower.includes(p))) {
      return { type: 'confirmed' };
    }

    // Check for total override
    const totalMatch = text.match(
      /total\s*(?:tha|hai|aaj|was|undi|irundhuchu)?\s*₹?\s*([\d,]+)/i
    );
    if (totalMatch) {
      return {
        type: 'different_total',
        amount: parseFloat(totalMatch[1].replace(/,/g, ''))
      };
    }

    // Check for cancel/miss keywords
    const hasCancelKeywords = /cancel|hatao|nahi hua|miss|galat|wrong|thappu/.test(lower);
    if (hasCancelKeywords) {
      return { type: 'corrections', corrections: text };
    }

    // Default: treat as additional transaction dictation
    return { type: 'additional' };
  }
}

const EOD_TEMPLATES = {
  en: "Today's count: ₹{credit_total} in, ₹{debit_total} out. Net ₹{net}. Correct? Anything else today?",
  hi: "Aaj ka hisab: ₹{credit_total} aaya, ₹{debit_total} gaya. Net ₹{net}. Sahi hai? Ya kuch aur hua aaj?",
  te: "Ee roju lekkhalu: ₹{credit_total} vachindi, ₹{debit_total} vellindi. Net ₹{net}. Correct aa? Inkemaina jarigindaa?",
  ta: "Innaiku kanakku: ₹{credit_total} vanthuchu, ₹{debit_total} pochchu. Net ₹{net}. Sari-yaa? Vera enna nadanthuchu?",
  kn: "Ivattu lekka: ₹{credit_total} bantu, ₹{debit_total} hoytu. Net ₹{net}. Sari-yaa? Bere enu aaytu?",
  bn: "Ajker hishab: ₹{credit_total} eshechhe, ₹{debit_total} gechhe. Net ₹{net}. Thik achhe? Ar kichu hoyechhe?",
  gu: "Aajno hisab: ₹{credit_total} aavya, ₹{debit_total} gaya. Net ₹{net}. Barabar chhe? Biju kai thayu?",
  mr: "Aajcha hishob: ₹{credit_total} aala, ₹{debit_total} gela. Net ₹{net}. Barobar aahe? Ajun kai zala?",
  ml: "Innalethe kanakku: ₹{credit_total} vannu, ₹{debit_total} poyi. Net ₹{net}. Sheri aano? Veere enthenkkilum undaayo?",
  or: "Aaji hisab: ₹{credit_total} asila, ₹{debit_total} gala. Net ₹{net}. Thik achhi? Aau kichhi hela?",
  pa: "Ajj da hisab: ₹{credit_total} aaya, ₹{debit_total} gaya. Net ₹{net}. Theek hai? Hor kuch hoya?"
};
```

**Why this matters:** This is the safety net. Even if SMS fails,
notifications miss something, and the owner forgets to voice-log a
cash payment — the end-of-day reconciliation catches the gap. The
owner always knows their actual day's total (they count the cash
drawer). The gap between what we captured and what they know is the
data we missed.

Over time, as the agent learns the owner's patterns, the gap should
shrink to near zero. A consistently large gap tells us a channel is
broken (SMS stopped working, notification permissions revoked, etc.).

---

### Channel 7: Bulk Import (New)

**Status:** Not built.

**How it works:** The owner sends a multi-page document containing
many transactions — a bank passbook photo, a PDF statement downloaded
from their banking app, or a screenshot of their Khatabook/Vyapar
export.

This is different from single-receipt OCR (Channel 4) because it
contains multiple transactions that need to be parsed as a batch,
deduped against existing entries, and imported with a shared batch_id.

**Document types and parsing strategies:**

**A. Bank passbook photo (camera capture)**
- Sarvam Vision OCR extracts the table
- Parse rows: date | description | debit | credit | balance
- Each row becomes a transaction
- The running balance column is a verification checksum — if our
  parsed amounts don't reconcile with the balance column, flag
  the discrepancy
- Assign `batch_id` = `passbook_YYYYMMDD_HHMMSS`
- Dedup against existing transactions by date + amount + ref_id
  (the description often contains a UPI ref or cheque number)

**B. PDF bank statement (downloaded from banking app)**
- Extract text from PDF (pdf-parse or similar)
- Same row parsing as passbook
- PDF statements have cleaner formatting than photos — higher
  confidence (0.90 vs 0.75 for photo)
- Some banks include CSV export — parse CSV directly (highest
  confidence: 0.95)

**C. Banking app screenshot**
- Owner screenshots their banking app's transaction history
- Sarvam Vision OCR extracts visible transactions
- Typically shows 5-10 transactions per screenshot
- Multiple screenshots = multiple batches
- Lower confidence (0.80) because screen renders can be
  inconsistent

**D. Khatabook/Vyapar export**
- If owner was using another app before DhandhaPhone, they
  may have historical data
- Khatabook exports as PDF with customer-wise credit/debit
- Vyapar exports as Excel or PDF with itemized transactions
- One-time migration: import historical data, set is_confirmed = 0,
  ask owner to review totals

**Implementation:**

```javascript
// gateway/ingestion/bulk-import.js

class BulkImporter {
  constructor(db, ocr) {
    this.db = db;
    this.ocr = ocr;
  }

  async importDocument(filePath, documentType, language) {
    const batchId = `batch_${Date.now()}`;
    let transactions = [];

    switch (documentType) {
      case 'passbook_photo':
        const ocrText = await this.ocr.extract(filePath);
        transactions = this.parsePassbookRows(ocrText);
        break;
      case 'pdf_statement':
        const pdfText = await this.extractPDF(filePath);
        transactions = this.parseStatementRows(pdfText);
        break;
      case 'app_screenshot':
        const screenText = await this.ocr.extract(filePath);
        transactions = this.parseScreenRows(screenText);
        break;
      case 'csv_export':
        const csvData = fs.readFileSync(filePath, 'utf8');
        transactions = this.parseCSV(csvData);
        break;
    }

    // Dedup against existing
    const { newTxns, dupes } = await this.dedupBatch(transactions);

    // Write new transactions
    let imported = 0;
    for (const txn of newTxns) {
      await this.db.addTransaction({
        ...txn,
        source: 'bank_import',
        batch_id: batchId,
        is_confirmed: 0,  // Not confirmed until owner reviews
        confidence: this.getConfidence(documentType)
      });
      imported++;
    }

    return {
      batchId,
      total: transactions.length,
      imported,
      duplicates: dupes.length,
      language
    };
  }

  async dedupBatch(transactions) {
    const newTxns = [];
    const dupes = [];

    for (const txn of transactions) {
      // Check by reference_id first (strongest match)
      if (txn.reference_id) {
        const existing = this.db.prepare(`
          SELECT id FROM transactions
          WHERE reference_id = ? AND is_deleted = 0
        `).get(txn.reference_id);
        if (existing) { dupes.push(txn); continue; }
      }

      // Check by amount + date + similar counterparty
      const sameDay = this.db.prepare(`
        SELECT id FROM transactions
        WHERE amount = ? AND transaction_date = ?
          AND type = ? AND is_deleted = 0
      `).all(txn.amount, txn.transaction_date, txn.type);

      if (sameDay.length > 0) {
        // Same amount and date — likely duplicate
        dupes.push(txn);
        continue;
      }

      newTxns.push(txn);
    }

    return { newTxns, dupes };
  }

  getConfidence(documentType) {
    const confidenceMap = {
      'passbook_photo': 0.75,
      'pdf_statement': 0.90,
      'app_screenshot': 0.80,
      'csv_export': 0.95
    };
    return confidenceMap[documentType] || 0.70;
  }
}
```

**Post-import message (multilingual):**

```javascript
const IMPORT_TEMPLATES = {
  en: "Imported {imported} transactions from your {type}. {dupes} were already recorded. Please review — say 'sahi hai' to confirm or tell me what's wrong.",
  hi: "Aapke {type} se {imported} transactions import kiye. {dupes} pehle se the. Dekh lo — 'sahi hai' bolo ya galti batao.",
  te: "Mee {type} nundi {imported} transactions import chesamu. {dupes} mundu nundi unnaayi. Choodandi — 'correct' cheppandi leda tappulu cheppandi.",
  ta: "Unga {type} la irundhu {imported} transactions import panninom. {dupes} munnadi irundhadhu. Parunga — 'sari' sollungal illa thappugal sollungal."
  // ... other languages
};
```

---

## Channel 2 Deep Dive: Notification Listener

This is the biggest implementation gap and the highest-priority work.

### Current State

**What exists:**
- `lib/termux-api.js` has `getNotifications()` → calls
  `termux-notification-list`
- `sms-parser.js` has `parseUPINotification()` for 3 apps:
  Google Pay, PhonePe, Paytm
- `sms-poller.js` calls `getNotifications()` after SMS processing,
  does basic dedup, writes to ledger + DB
- `skills/notification-watch/SKILL.md` — full spec for 13 apps

**What's missing:**
- No dedicated notification poller script
  (`skills/notification-watch/scripts/` is empty)
- 10 of 13 apps have no parser
- Piggybacking on SMS poller instead of running independently
- Weak dedup (amount + type in 5-min window only)
- No multilingual alerts
- No test suite

### Architecture: Standalone Notification Poller

The notification listener needs its own polling loop, separate from
the SMS poller. Notifications arrive differently — they're ephemeral
(dismissed by the user), they come from many different apps with
different formats, and they need faster processing than SMS (some
payment notifications are time-sensitive for the business owner).

```
┌──────────────────────────────────────────────┐
│         NOTIFICATION POLLER                   │
│         (runs every 2 minutes)               │
│                                              │
│  1. termux-notification-list                  │
│     → raw JSON array of all active notifs     │
│                                              │
│  2. Filter by package name                    │
│     → keep only monitored apps               │
│     → discard system notifs, irrelevant apps  │
│                                              │
│  3. Dedup by notification ID                  │
│     → skip already-processed notifications    │
│     → notification ID stored in notif_log     │
│                                              │
│  4. Route to app-specific parser              │
│     → GPay parser, PhonePe parser, etc.       │
│     → extract: amount, type, counterparty,    │
│       ref_id, method                          │
│                                              │
│  5. Cross-channel dedup                       │
│     → check if SMS already captured this txn  │
│     → match by ref_id OR (amount + time)      │
│                                              │
│  6. Write to transactions table               │
│     → source: 'notification'                  │
│     → confidence: per-app (0.80 - 0.95)       │
│                                              │
│  7. Alert decision                            │
│     → Food order (Swiggy/Zomato)? IMMEDIATE   │
│     → Large payment? Alert owner              │
│     → Normal? Log silently                    │
└──────────────────────────────────────────────┘
```

### The 13 Apps and Their Notification Formats

Every Android notification returned by `termux-notification-list`
has this structure:

```json
{
  "id": 12345,
  "tag": "payment_success",
  "key": "0|com.google.android.apps.nbu.paisa.user|12345|null|10088",
  "group": "payment_group",
  "packageName": "com.google.android.apps.nbu.paisa.user",
  "title": "Payment sent",
  "content": "₹5,000 sent to RAJAN KUMAR via UPI. UPI Ref: 567890123456",
  "when": 1708234567890
}
```

The key fields for parsing: `packageName` (identifies the app),
`title` (short description), `content` (full notification text),
`when` (timestamp in milliseconds).

#### Category A: UPI Payment Apps (4 apps)

**1. Google Pay (com.google.android.apps.nbu.paisa.user)**

```
Title patterns:
  "Payment sent"           → debit
  "Payment received"       → credit
  "₹{amount} received"    → credit
  "₹{amount} sent"        → debit
  "Payment to {name}"     → debit
  "Payment from {name}"   → credit

Content patterns:
  "₹{amount} sent to {name} via UPI. UPI Ref: {ref}"
  "₹{amount} received from {name}. UPI Ref: {ref}"
  "You paid ₹{amount} to {name}. UPI Ref: {ref}"
  "Payment of ₹{amount} received from {name}"
  "₹{amount} paid to {merchant_name}"

Parser:
```javascript
function parseGPay(title, content) {
  // Try content first (more detailed)
  const contentMatch = content.match(
    /₹\s*([\d,]+(?:\.\d{2})?)\s*(?:sent to|paid to|received from)\s*(.+?)(?:\.|\s*via|\s*UPI)/i
  );
  if (contentMatch) {
    const amount = parseFloat(contentMatch[1].replace(/,/g, ''));
    const counterparty = contentMatch[2].trim();
    const type = /sent|paid/i.test(content) ? 'debit' : 'credit';
    const refMatch = content.match(/(?:UPI\s*Ref|Ref\.?\s*(?:No|ID)?)[:\s]*(\d{10,})/i);
    return {
      amount, type, counterparty,
      method: 'UPI',
      reference_id: refMatch ? refMatch[1] : null,
      confidence: 0.92
    };
  }

  // Fallback: try title
  const titleMatch = title.match(/₹\s*([\d,]+)/);
  if (titleMatch) {
    return {
      amount: parseFloat(titleMatch[1].replace(/,/g, '')),
      type: /sent|paid|payment to/i.test(title) ? 'debit' : 'credit',
      counterparty: null,
      method: 'UPI',
      reference_id: null,
      confidence: 0.75  // Lower — no ref, no counterparty
    };
  }

  return null;
}
```

**2. PhonePe (com.phonepe.app)**

```
Title patterns:
  "Payment Successful"     → debit
  "Money Received"         → credit
  "Received ₹{amount}"    → credit
  "Sent ₹{amount}"        → debit
  "Cashback of ₹{amount}" → credit (cashback, not business txn)

Content patterns:
  "₹{amount} sent to {name} successfully! Ref: {ref}"
  "Received ₹{amount} from {name}. Ref No. {ref}"
  "Payment of ₹{amount} to {merchant} successful"
  "₹{amount} cashback credited to your PhonePe wallet"

Special handling:
  - Cashback notifications should be logged with category: 'cashback'
    and lower priority (don't alert owner)
  - Wallet-to-bank transfers should be ignored (internal movement,
    not a business transaction)
  - "Autopay" notifications = recurring payments (SIP, insurance)
    log with category: 'recurring'
```

**3. Paytm (net.one97.paytm)**

```
Title patterns:
  "Payment Successful"
  "Money Added"
  "Money Received"
  "Cashback Received"

Content patterns:
  "₹{amount} paid to {name}. Order ID: {ref}"
  "₹{amount} received from {name}"
  "₹{amount} added to Paytm Wallet"
  "Cashback of ₹{amount} added"
  "Payment of ₹{amount} for {description} successful"

Special handling:
  - "Added to Paytm Wallet" = internal, ignore
  - "Paid from Wallet" vs "Paid from Bank" = different method
    (WALLET vs UPI)
  - Paytm for Business notifications (if owner has Paytm Business):
    "₹{amount} received. Total today: ₹{total}"
    → Parse both the transaction amount AND the daily total
      (use the daily total as a reconciliation cross-check)
```

**4. BHIM (in.org.npci.upiapp)**

```
Title patterns:
  "Transaction Successful"
  "Money Received"

Content patterns:
  "Paid ₹{amount} to {VPA}. UPI Ref: {ref}"
  "Received ₹{amount} from {VPA}. UPI Ref: {ref}"
  "₹{amount} debited from A/c {last4}. UPI Ref {ref}"
  "₹{amount} credited to A/c {last4}. UPI Ref {ref}"

Notes:
  - BHIM often shows VPA (UPI address) instead of name
    e.g., "rajan@ybl" instead of "Rajan Kumar"
  - We need a VPA-to-contact resolution step
  - VPA lookup: check contacts table for matching VPA
    (store in properties JSON) or infer from name portion
    of VPA (rajan@ybl → search for "Rajan" in contacts)
```

#### Category B: POS/Payment Processing Apps (4 apps)

These are relevant for businesses that accept card or QPI payments
through a POS terminal or payment gateway.

**5. Pine Labs (com.pinelabs.masterapp)**

```
Content patterns:
  "Transaction approved ₹{amount} on {terminal_id}"
  "Sale of ₹{amount} - Card ending {last4}"
  "Settlement of ₹{amount} processed to your account"

Special handling:
  - "Transaction approved" = card sale, log as credit, method: 'CARD'
  - "Settlement" = batch settlement from Pine Labs to bank account
    This is a DUPLICATE of the individual card sales. Do NOT log
    settlements as new transactions — instead, use the settlement
    amount to verify that individual card transactions sum correctly.
  - Store terminal_id in transaction properties for auditing
```

**6. Razorpay (com.razorpay.payments.app)**

```
Content patterns:
  "₹{amount} received via {method}. Payment ID: {ref}"
  "Payment of ₹{amount} from {customer} successful"
  "Settlement of ₹{amount} initiated"

Special handling:
  - Same settlement dedup issue as Pine Labs
  - Razorpay deducts their fee before settlement — the settlement
    amount will be less than the sum of payments. The fee is a
    debit we should capture: "Razorpay fee: ₹{amount}"
  - Method can be: UPI, Card, Netbanking, Wallet
```

**7. Petpooja (com.petpooja.app)**

```
Content patterns:
  "New Order #{order_id} - ₹{amount}"
  "Order #{order_id} completed - ₹{amount}"
  "Table {number} - Bill ₹{amount}"
  "KOT #{id} - {items}"

Special handling:
  - Restaurant-specific POS
  - "New Order" = order placed, not yet paid
  - "Order completed" = paid, log as credit
  - "KOT" (Kitchen Order Ticket) = not financial, ignore
  - Capture order_id as reference_id for linking with
    Swiggy/Zomato orders (if order came from platform)
```

**8. Instamojo (com.instamojo.app)**

```
Content patterns:
  "Payment of ₹{amount} received"
  "₹{amount} payment link paid by {customer}"
  "Payout of ₹{amount} initiated"

Special handling:
  - Payment links are common for small businesses
    (invoicing, advance payments)
  - "Payout" = settlement from Instamojo to bank — dedup risk
```

#### Category C: Platform/Marketplace Apps (4 apps)

These are for businesses that sell through food delivery or
e-commerce platforms.

**9. Swiggy Partner (in.swiggy.partner.app)**

```
Content patterns:
  "New order! #{order_id} - {items} - ₹{amount}"
  "Order #{order_id} picked up"
  "Order #{order_id} delivered"
  "Weekly payout: ₹{amount}"
  "Daily summary: {count} orders, ₹{total}"

Special handling:
  - CRITICAL: New order notification ≠ money received
    Money comes via weekly/daily payout to bank account
  - Log individual orders as type: 'pending_platform_credit'
    with is_confirmed: 0
  - Log payout as confirmed credit with method: 'BANK'
  - Reconcile: sum of individual orders should ≈ payout amount
    (minus Swiggy commission, typically 15-30%)
  - Store commission as a debit: "Swiggy commission"
  - "Daily summary" is a useful cross-check
  - IMMEDIATE ALERT on new order (owner needs to start cooking)
```

**10. Zomato Partner (com.application.zomato.merchant)**

```
Content patterns:
  "New order #{order_id} from {customer_name}"
  "Order #{order_id}: {items} - ₹{amount}"
  "Payout processed: ₹{amount}"
  "Daily earnings: ₹{total} from {count} orders"

Special handling:
  - Same platform accounting as Swiggy
  - IMMEDIATE ALERT on new order
  - Zomato commission typically 18-25%
```

**11. Amazon Seller (com.amazon.sellermobile.android)**

```
Content patterns:
  "New order: {product} - ₹{amount}"
  "Order #{order_id} shipped"
  "Payment of ₹{amount} deposited to your bank"
  "Return requested for order #{order_id}"

Special handling:
  - Orders vs settlements (same pattern as Swiggy/Zomato)
  - Returns need special handling — create a negative
    transaction (debit) to reverse the original credit
  - Amazon typically settles every 7-14 days
  - Store product name in transaction description
```

**12. Flipkart Seller (com.flipkart.seller)**

```
Content patterns:
  "New order for {product}"
  "₹{amount} payment processed"
  "Return initiated for order #{id}"
  "Settlement of ₹{amount} completed"

Special handling:
  - Same as Amazon — orders vs settlements
  - Flipkart commission varies by category (5-25%)
```

#### Category D: Banking Apps (1 app, expandable)

**13. Bank-specific apps (various package names)**

```
Common package names:
  com.sbi.SBIFreedomPlus          (SBI YONO)
  com.csam.icici.bank.imobile     (ICICI iMobile)
  com.hdfc.retail.banking         (HDFC MobileBanking)
  com.axis.mobile                 (Axis Mobile)
  com.kotak.mobile.banking        (Kotak)
  com.ucobank.mbanking            (UCO Bank)

Content patterns (bank apps are similar to bank SMS):
  "₹{amount} credited to A/c {last4}. {description}. Bal: ₹{balance}"
  "₹{amount} debited from A/c {last4}. {description}. Bal: ₹{balance}"

Special handling:
  - These are PURE DUPLICATES of SMS — if SMS also arrived,
    we MUST dedup
  - Banking app notifications often arrive faster than SMS
  - If banking app notification arrives first, capture it.
    When SMS arrives later, dedup will skip it.
  - The balance figure is a verification cross-check
```

### The Notification Parser Registry

Instead of a giant switch statement, use a registry pattern where
each app's parser is a self-contained module:

```javascript
// gateway/ingestion/notification-parser.js

class NotificationParserRegistry {
  constructor() {
    this.parsers = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // UPI Apps
    this.register('com.google.android.apps.nbu.paisa.user', {
      name: 'Google Pay',
      category: 'upi',
      parse: parseGPay,
      confidence: 0.92,
      alertLevel: 'normal'
    });
    this.register('com.phonepe.app', {
      name: 'PhonePe',
      category: 'upi',
      parse: parsePhonePe,
      confidence: 0.90,
      alertLevel: 'normal'
    });
    this.register('net.one97.paytm', {
      name: 'Paytm',
      category: 'upi',
      parse: parsePaytm,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('in.org.npci.upiapp', {
      name: 'BHIM',
      category: 'upi',
      parse: parseBHIM,
      confidence: 0.90,
      alertLevel: 'normal'
    });

    // POS Apps
    this.register('com.pinelabs.masterapp', {
      name: 'Pine Labs',
      category: 'pos',
      parse: parsePineLabs,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('com.razorpay.payments.app', {
      name: 'Razorpay',
      category: 'pos',
      parse: parseRazorpay,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('com.petpooja.app', {
      name: 'Petpooja',
      category: 'pos',
      parse: parsePetpooja,
      confidence: 0.85,
      alertLevel: 'immediate'  // Food orders need fast response
    });
    this.register('com.instamojo.app', {
      name: 'Instamojo',
      category: 'pos',
      parse: parseInstamojo,
      confidence: 0.88,
      alertLevel: 'normal'
    });

    // Platform Apps
    this.register('in.swiggy.partner.app', {
      name: 'Swiggy Partner',
      category: 'platform',
      parse: parseSwiggy,
      confidence: 0.90,
      alertLevel: 'immediate'  // New orders need instant alert
    });
    this.register('com.application.zomato.merchant', {
      name: 'Zomato Partner',
      category: 'platform',
      parse: parseZomato,
      confidence: 0.90,
      alertLevel: 'immediate'
    });
    this.register('com.amazon.sellermobile.android', {
      name: 'Amazon Seller',
      category: 'platform',
      parse: parseAmazon,
      confidence: 0.85,
      alertLevel: 'normal'
    });
    this.register('com.flipkart.seller', {
      name: 'Flipkart Seller',
      category: 'platform',
      parse: parseFlipkart,
      confidence: 0.85,
      alertLevel: 'normal'
    });

    // Banking Apps (add as discovered on owner's phone)
    const bankPackages = [
      'com.sbi.SBIFreedomPlus',
      'com.csam.icici.bank.imobile',
      'com.hdfc.retail.banking',
      'com.axis.mobile',
      'com.kotak.mobile.banking'
    ];
    for (const pkg of bankPackages) {
      this.register(pkg, {
        name: 'Banking App',
        category: 'bank',
        parse: parseBankNotification,
        confidence: 0.85,
        alertLevel: 'normal'
      });
    }
  }

  register(packageName, parser) {
    this.parsers.set(packageName, parser);
  }

  getParser(packageName) {
    return this.parsers.get(packageName) || null;
  }

  getMonitoredPackages() {
    return [...this.parsers.keys()];
  }
}
```

### The Notification Poller

This is the main script that should run on its own cron schedule
(every 2 minutes), independent of the SMS poller.

```javascript
// gateway/ingestion/notification-poller.js

const { getNotifications } = require('../lib/termux-api');
const { NotificationParserRegistry } = require('./notification-parser');
const { DhandhaDB } = require('../db/db');
const crypto = require('crypto');

class NotificationPoller {
  constructor(db) {
    this.db = db;
    this.registry = new NotificationParserRegistry();
  }

  async poll() {
    // 1. Get all current notifications
    const allNotifications = await getNotifications();
    if (!allNotifications || allNotifications.length === 0) return [];

    // 2. Filter to monitored apps
    const monitored = allNotifications.filter(
      n => this.registry.getParser(n.packageName)
    );

    const results = [];
    for (const notif of monitored) {
      try {
        const result = await this.processNotification(notif);
        if (result) results.push(result);
      } catch (err) {
        console.error(
          `Error processing notification from ${notif.packageName}:`,
          err.message
        );
      }
    }

    return results;
  }

  async processNotification(notif) {
    // 3. Check if already processed (notification-level dedup)
    const notifHash = this.hashNotification(notif);
    const alreadyProcessed = this.db.prepare(`
      SELECT 1 FROM notification_log WHERE hash = ?
    `).get(notifHash);
    if (alreadyProcessed) return null;

    // 4. Parse with app-specific parser
    const parser = this.registry.getParser(notif.packageName);
    const parsed = parser.parse(notif.title, notif.content);
    if (!parsed) {
      // Not a financial notification (e.g., GPay promotional)
      // Log as processed so we don't re-attempt
      this.logProcessed(notifHash, notif.packageName, 'skipped');
      return null;
    }

    // 5. Cross-channel dedup (was this already captured by SMS?)
    const isDupe = await this.crossChannelDedup(parsed);
    if (isDupe) {
      this.logProcessed(notifHash, notif.packageName, 'duplicate');
      return null;
    }

    // 6. Write transaction
    const txnId = await this.db.addTransaction({
      type: parsed.type,
      amount: parsed.amount,
      counterparty_name: parsed.counterparty,
      method: parsed.method || 'UPI',
      source: 'notification',
      reference_id: parsed.reference_id,
      original_message: `[${parser.name}] ${notif.title}: ${notif.content}`,
      confidence: parsed.confidence || parser.confidence,
      is_confirmed: parsed.confidence >= 0.85 ? 1 : 0,
      transaction_date: new Date(notif.when).toISOString()
    });

    // 7. Log as processed
    this.logProcessed(notifHash, notif.packageName, 'captured', txnId);

    // 8. Write dedup entry for cross-channel matching
    const dedupHash = this.computeDedupHash(parsed);
    this.db.prepare(`
      INSERT OR IGNORE INTO dedup_log (hash, source, transaction_id)
      VALUES (?, 'notification', ?)
    `).run(dedupHash, txnId);

    return {
      transaction_id: txnId,
      app: parser.name,
      amount: parsed.amount,
      type: parsed.type,
      alertLevel: parser.alertLevel,
      counterparty: parsed.counterparty
    };
  }

  async crossChannelDedup(parsed) {
    // Strategy 1: Match by reference_id (strongest)
    if (parsed.reference_id) {
      const existing = this.db.prepare(`
        SELECT 1 FROM transactions
        WHERE reference_id = ? AND is_deleted = 0
      `).get(parsed.reference_id);
      if (existing) return true;

      // Also check dedup_log
      const dedupRef = this.db.prepare(`
        SELECT 1 FROM dedup_log WHERE hash LIKE ?
      `).get(`%${parsed.reference_id}%`);
      if (dedupRef) return true;
    }

    // Strategy 2: Match by amount + time window (weaker)
    const window = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    const recentSame = this.db.prepare(`
      SELECT 1 FROM transactions
      WHERE amount = ? AND type = ? AND source != 'notification'
        AND is_deleted = 0
        AND abs(
          strftime('%s', transaction_date) * 1000 - ?
        ) < ?
    `).get(parsed.amount, parsed.type, now, window);

    return !!recentSame;
  }

  hashNotification(notif) {
    // Unique per notification instance
    const raw = `${notif.packageName}|${notif.id}|${notif.when}|${notif.content}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  computeDedupHash(parsed) {
    // Cross-channel dedup hash — matches how SMS poller hashes
    const dateStr = new Date().toISOString().split('T')[0];
    const raw = `${parsed.amount}|${dateStr}|${parsed.reference_id || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  logProcessed(hash, packageName, status, transactionId = null) {
    this.db.prepare(`
      INSERT OR IGNORE INTO notification_log
      (hash, package_name, status, transaction_id, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(hash, packageName, status, transactionId);
  }
}
```

### New Table: notification_log

Added to the schema alongside the existing dedup_log:

```sql
-- ============================================
-- NOTIFICATION LOG (tracks processed notifications)
-- ============================================
-- Separate from dedup_log because notifications need
-- additional metadata (package name, status) and the
-- dedup_log is shared across all channels.
-- ============================================
CREATE TABLE IF NOT EXISTS notification_log (
  hash            TEXT PRIMARY KEY,
  package_name    TEXT NOT NULL,
  status          TEXT NOT NULL,    -- 'captured', 'duplicate', 'skipped', 'error'
  transaction_id  INTEGER REFERENCES transactions(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_log_pkg
  ON notification_log(package_name);
CREATE INDEX IF NOT EXISTS idx_notif_log_status
  ON notification_log(status);

-- Clean up old entries (older than 30 days)
-- Run in heartbeat daily maintenance
-- DELETE FROM notification_log
--   WHERE created_at < datetime('now', '-30 days');
```

### Dedup Strategy: The Full Picture

The current dedup (amount + type in 5-min window) is fragile. Here's
the improved three-tier approach:

```
TIER 1: Reference ID match (strongest, 100% confidence)
  If two transactions share the same UPI reference number,
  they are definitively the same transaction.
  SMS and notification for the same UPI payment both contain
  the same ref number.

TIER 2: Hash match (strong, 95% confidence)
  SHA256 of (amount + date + reference_id).
  Stored in dedup_log by both SMS poller and notification poller.
  If hash exists, skip.

TIER 3: Fuzzy match (weaker, used as fallback)
  Same amount + same type + within 10-minute window.
  But NOT if different counterparties are named.
  (₹5,000 from Rajan at 10:15 is different from
   ₹5,000 from Sharma at 10:20, even if same amount and window)
  This catches cases where ref_id wasn't extracted from
  one of the sources.
```

```javascript
// gateway/ingestion/dedup.js

class DedupEngine {
  constructor(db) {
    this.db = db;
  }

  async isDuplicate(parsed, source) {
    // Tier 1: Reference ID
    if (parsed.reference_id) {
      const refMatch = this.db.prepare(`
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

    // Tier 2: Hash match
    const hash = this.computeHash(parsed);
    const hashMatch = this.db.prepare(`
      SELECT transaction_id, source FROM dedup_log
      WHERE hash = ?
    `).get(hash);

    if (hashMatch) {
      return {
        isDupe: true,
        tier: 2,
        matchedTxnId: hashMatch.transaction_id,
        matchedSource: hashMatch.source,
        confidence: 0.95
      };
    }

    // Tier 3: Fuzzy match
    const windowMs = 10 * 60; // 10 minutes in seconds
    const fuzzyMatch = this.db.prepare(`
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
      parsed.transaction_date || new Date().toISOString(),
      windowMs
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

  computeHash(parsed) {
    const dateStr = (parsed.transaction_date || new Date().toISOString())
      .split('T')[0];
    const raw = `${parsed.amount}|${dateStr}|${parsed.reference_id || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  nameSimilarity(a, b) {
    // Simple normalized Levenshtein distance
    const aLower = (a || '').toLowerCase().trim();
    const bLower = (b || '').toLowerCase().trim();
    if (aLower === bLower) return 1.0;
    if (!aLower || !bLower) return 0.0;

    // Check if one contains the other (common for UPI names
    // vs contact names: "RAJAN KUMAR" contains "rajan")
    if (aLower.includes(bLower) || bLower.includes(aLower)) {
      return 0.8;
    }

    // Levenshtein for everything else
    const maxLen = Math.max(aLower.length, bLower.length);
    const distance = levenshtein(aLower, bLower);
    return 1 - (distance / maxLen);
  }
}
```

### Platform Accounting: Orders vs Settlements

For platform businesses (Swiggy, Zomato, Amazon, Flipkart), there's
a fundamental accounting challenge: the notification for "New Order
₹500" is NOT the same as receiving ₹500. The platform collects the
money, takes a commission (15-30%), and settles the remainder to the
owner's bank account days or weeks later.

If we naively log every order notification as a credit, the owner's
books will show revenue they haven't actually received yet. And when
the settlement arrives (via bank SMS or notification), we'd double-count.

**Solution: Pending platform credits**

```javascript
// Platform order notifications create PENDING entries
async function logPlatformOrder(parsed, platform) {
  return await db.addTransaction({
    type: 'credit',
    amount: parsed.amount,
    counterparty_name: `${platform} Order #${parsed.orderId}`,
    method: 'PLATFORM',
    source: 'notification',
    category: 'platform_pending',     // Special category
    reference_id: parsed.orderId,
    description: parsed.items || null,
    confidence: parsed.confidence,
    is_confirmed: 0,                  // NOT confirmed until settled
    transaction_date: new Date().toISOString()
  });
}

// Platform settlement notifications reconcile pending entries
async function logPlatformSettlement(parsed, platform) {
  // Find pending orders for this platform
  const pendingOrders = db.prepare(`
    SELECT id, amount FROM transactions
    WHERE category = 'platform_pending'
      AND counterparty_name LIKE ?
      AND is_confirmed = 0 AND is_deleted = 0
    ORDER BY transaction_date ASC
  `).all(`${platform}%`);

  const pendingTotal = pendingOrders.reduce(
    (sum, o) => sum + o.amount, 0
  );
  const settlementAmount = parsed.amount;
  const impliedCommission = pendingTotal - settlementAmount;

  // Mark pending orders as settled
  for (const order of pendingOrders) {
    db.prepare(`
      UPDATE transactions SET
        category = 'platform_settled',
        is_confirmed = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);
  }

  // Log the settlement (actual money received)
  await db.addTransaction({
    type: 'credit',
    amount: settlementAmount,
    counterparty_name: `${platform} Settlement`,
    method: 'BANK',
    source: 'notification',
    category: 'platform_settlement',
    confidence: 0.95,
    is_confirmed: 1,
    transaction_date: new Date().toISOString()
  });

  // Log the commission as a debit
  if (impliedCommission > 0) {
    await db.addTransaction({
      type: 'debit',
      amount: impliedCommission,
      counterparty_name: `${platform} Commission`,
      method: 'PLATFORM',
      source: 'system',
      category: 'platform_commission',
      confidence: 0.80,
      is_confirmed: 0,  // Owner should verify
      transaction_date: new Date().toISOString()
    });
  }

  return {
    ordersSettled: pendingOrders.length,
    grossAmount: pendingTotal,
    netReceived: settlementAmount,
    impliedCommission
  };
}
```

---

## Data Health: Knowing What's Working

The system should be self-aware about its data quality. If SMS
notifications stop arriving, the owner doesn't know — they just
see an incomplete picture. The agent should detect channel failures
and alert the owner.

### Channel Health Monitor

```javascript
// gateway/ingestion/channel-health.js

class ChannelHealth {
  constructor(db) {
    this.db = db;
  }

  async checkHealth() {
    const issues = [];

    // Check SMS freshness
    const lastSMS = this.db.prepare(`
      SELECT MAX(created_at) as latest FROM transactions
      WHERE source = 'sms'
    `).get();
    const smsSilentHours = this.hoursSince(lastSMS?.latest);
    if (smsSilentHours > 24) {
      issues.push({
        channel: 'sms',
        severity: 'warning',
        message: `No SMS transactions in ${Math.round(smsSilentHours)} hours`,
        suggestion: 'check_dnd_settings'
      });
    }

    // Check notification freshness
    const lastNotif = this.db.prepare(`
      SELECT MAX(created_at) as latest FROM transactions
      WHERE source = 'notification'
    `).get();
    const notifSilentHours = this.hoursSince(lastNotif?.latest);
    if (notifSilentHours > 48) {
      issues.push({
        channel: 'notification',
        severity: 'warning',
        message: `No notification transactions in ${Math.round(notifSilentHours)} hours`,
        suggestion: 'check_notification_permissions'
      });
    }

    // Check dedup ratio (high dupes = healthy overlap)
    const last7days = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'captured' THEN 1 END) as captured,
        COUNT(CASE WHEN status = 'duplicate' THEN 1 END) as duplicates,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped
      FROM notification_log
      WHERE created_at > datetime('now', '-7 days')
    `).get();

    // If zero duplicates for 7 days, SMS and notifications aren't
    // overlapping — one channel is probably dead
    if (last7days.captured > 10 && last7days.duplicates === 0) {
      issues.push({
        channel: 'cross_channel',
        severity: 'info',
        message: 'No SMS-notification overlap detected in 7 days',
        suggestion: 'verify_both_channels_active'
      });
    }

    // Check capture rate vs EOD reconciliation gap
    const lastEOD = this.db.prepare(`
      SELECT properties FROM brain_observations
      WHERE type = 'insight' AND content LIKE '%reconciliation%'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    if (lastEOD) {
      const eodData = JSON.parse(lastEOD.properties || '{}');
      if (eodData.gap_percentage > 20) {
        issues.push({
          channel: 'overall',
          severity: 'warning',
          message: `Capturing only ~${100 - eodData.gap_percentage}% of daily transactions automatically`,
          suggestion: 'increase_manual_logging'
        });
      }
    }

    return issues;
  }

  hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
  }

  // Run weekly — generates a brain_observation about channel health
  async generateHealthReport() {
    const issues = await this.checkHealth();

    if (issues.length > 0) {
      const content = issues.map(i =>
        `${i.channel}: ${i.message}`
      ).join('; ');

      await this.db.prepare(`
        INSERT INTO brain_observations
        (type, content, properties, confidence, source, expires_at)
        VALUES ('insight', ?, ?, 0.8, 'analysis',
                datetime('now', '+7 days'))
      `).run(
        `Data health: ${issues.length} issue(s) detected. ${content}`,
        JSON.stringify({ issues })
      );
    }

    return issues;
  }
}
```

### Multilingual Health Alerts

When a channel fails, the owner needs to know — in their language,
in terms they understand, with a specific action to take:

```javascript
const HEALTH_ALERTS = {
  check_dnd_settings: {
    en: "I haven't received any bank SMS in {hours} hours. Check if DND is blocking messages — go to Settings > Messages > Block settings.",
    hi: "Mujhe {hours} ghante se koi bank SMS nahi mila. DND check karo — Settings > Messages > Block settings mein jaao.",
    te: "Naaku {hours} gantala nundi bank SMS raaledu. DND check cheyandi — Settings > Messages > Block settings lo choodandi.",
    ta: "Enakku {hours} mani neram-aa bank SMS varala. DND check pannunga — Settings > Messages > Block settings la parunga.",
    kn: "Nanage {hours} ghante inda bank SMS barilla. DND check maadi — Settings > Messages > Block settings alli noodi.",
    bn: "Amar {hours} ghonta dhore kono bank SMS asheni. DND check koren — Settings > Messages > Block settings e jaan.",
    gu: "Mane {hours} kalak thi koi bank SMS nathi aavyo. DND check karo — Settings > Messages > Block settings ma jao.",
    mr: "Mala {hours} taasanpasun kahi bank SMS aala nahi. DND check kara — Settings > Messages > Block settings madhe jaa.",
    ml: "Enikku {hours} manikkoore aayi bank SMS vannilla. DND check cheyyoo — Settings > Messages > Block settings il nokkoo.",
    or: "Mote {hours} ghanta hela kounasi bank SMS asini. DND check kara — Settings > Messages > Block settings re jaa.",
    pa: "Mainu {hours} ghante ton koi bank SMS nahi aaya. DND check karo — Settings > Messages > Block settings ch jao."
  },
  check_notification_permissions: {
    en: "I'm not seeing payment app notifications. Check if Termux has notification access — Settings > Apps > Termux > Notifications.",
    hi: "Mujhe payment app notifications nahi dikh rahe. Termux ka notification access check karo — Settings > Apps > Termux > Notifications.",
    te: "Payment app notifications kanipinchhatledu. Termux notification access check cheyandi — Settings > Apps > Termux > Notifications.",
    ta: "Payment app notifications theriyala. Termux notification access check pannunga — Settings > Apps > Termux > Notifications.",
    // ... other languages
  }
};
```

---

## Confidence Scoring Across Channels

Every transaction enters the system with a confidence score. This
score influences how the agent treats the transaction — high
confidence transactions are logged silently, low confidence ones
trigger confirmation requests.

| Channel | Sub-type | Confidence | Confirmed by Default? |
|---------|----------|------------|----------------------|
| SMS | Bank alert with ref_id | 0.90 | Yes |
| SMS | Bank alert without ref_id | 0.80 | Yes |
| Notification | UPI app with ref_id | 0.92 | Yes |
| Notification | UPI app without ref_id | 0.75 | No — ask owner |
| Notification | POS app | 0.88 | Yes |
| Notification | Platform order | 0.90 | No — pending until settled |
| Notification | Platform settlement | 0.95 | Yes |
| Notification | Banking app | 0.85 | Yes |
| Voice | Clear amount + counterparty | 0.75 | Yes (agent confirmed) |
| Voice | Ambiguous amount | 0.50 | No — ask owner |
| Photo/OCR | Printed receipt | 0.80 | Yes |
| Photo/OCR | Handwritten bahi-khata | 0.60 | No — ask owner |
| Photo/OCR | Banking app screenshot | 0.90 | Yes |
| Forwarded | Parseable as bank SMS | 0.75 | Yes |
| Forwarded | Partially parsed | 0.60 | No — ask owner |
| Bulk import | CSV from bank | 0.95 | No — batch review |
| Bulk import | PDF statement | 0.90 | No — batch review |
| Bulk import | Passbook photo | 0.75 | No — batch review |
| EOD Recon | Owner confirms total | 1.00 | Yes |
| EOD Recon | Gap-fill (bulk cash) | 0.70 | Yes (owner approved) |

**Decision rule:**
- Confidence ≥ 0.80 → log silently, mark as confirmed
- Confidence 0.60–0.79 → log, but ask owner to confirm
- Confidence < 0.60 → don't log automatically, present to owner
  as "I think I saw this — can you confirm?"

---

## VPA-to-Contact Resolution

UPI notifications often show a VPA (rajan@ybl, sharma_store@paytm)
instead of a human-readable name. The agent needs to resolve VPAs
to known contacts.

```javascript
// gateway/ingestion/vpa-resolver.js

class VPAResolver {
  constructor(db) {
    this.db = db;
  }

  async resolve(vpa) {
    if (!vpa) return null;

    // Check known VPA mappings
    const known = this.db.prepare(`
      SELECT contact_id, contact_name FROM vpa_map
      WHERE vpa = ?
    `).get(vpa);
    if (known) return known;

    // Try to extract name from VPA
    // rajan@ybl → "rajan"
    // sharma_traders@paytm → "sharma traders"
    // 9876543210@upi → phone number lookup
    const [local, domain] = vpa.split('@');

    // Phone number VPA
    if (/^\d{10}$/.test(local)) {
      const contact = this.db.prepare(`
        SELECT id, name FROM contacts
        WHERE phone LIKE ? AND is_deleted = 0
      `).get(`%${local}`);
      if (contact) {
        this.saveMapping(vpa, contact.id, contact.name);
        return { contact_id: contact.id, contact_name: contact.name };
      }
    }

    // Name-based VPA
    const nameGuess = local.replace(/[_.\-]/g, ' ').toLowerCase();
    const candidates = this.db.prepare(`
      SELECT id, name FROM contacts
      WHERE name_normalized LIKE ? AND is_deleted = 0
    `).all(`%${nameGuess}%`);

    if (candidates.length === 1) {
      // Unambiguous match
      this.saveMapping(vpa, candidates[0].id, candidates[0].name);
      return {
        contact_id: candidates[0].id,
        contact_name: candidates[0].name
      };
    }

    // Ambiguous or no match — store VPA as counterparty_name
    // Agent will ask owner to confirm on next interaction
    return null;
  }

  saveMapping(vpa, contactId, contactName) {
    this.db.prepare(`
      INSERT OR REPLACE INTO vpa_map (vpa, contact_id, contact_name)
      VALUES (?, ?, ?)
    `).run(vpa, contactId, contactName);
  }
}
```

New table:

```sql
CREATE TABLE IF NOT EXISTS vpa_map (
  vpa             TEXT PRIMARY KEY,
  contact_id      INTEGER REFERENCES contacts(id),
  contact_name    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
```

---

## New Tables Summary

Added to the schema alongside the brain tables from
business_brain_architecture.md:

| # | Table | Purpose |
|---|-------|---------|
| 16 | notification_log | Tracks processed notifications with status |
| 17 | vpa_map | Maps UPI VPAs to known contacts |

Total schema: 17 tables (12 original + 3 brain + 2 ingestion).

---

## New File Structure

```
gateway/
├── ingestion/                          # NEW — Data ingestion module
│   ├── notification-poller.js          # Standalone notification polling
│   ├── notification-parser.js          # Parser registry + all 13 parsers
│   ├── forwarded-message-parser.js     # Parse forwarded WhatsApp/SMS
│   ├── eod-reconciliation.js           # End-of-day summary + gap filling
│   ├── bulk-import.js                  # Passbook/statement batch import
│   ├── dedup.js                        # Three-tier dedup engine
│   ├── vpa-resolver.js                 # UPI VPA → contact resolution
│   ├── channel-health.js              # Monitor channel freshness
│   └── confidence.js                   # Confidence scoring rules
├── db/
│   └── schema.sql                      # +notification_log, +vpa_map
└── config/
    └── HEARTBEAT.md                    # Updated: separate notif polling
```

---

## Implementation Schedule

### Phase 1: Core Notification Poller (2 days)

**Day 1: Parser registry + 4 UPI parsers**
- [ ] Create `notification-parser.js` with registry pattern
- [ ] Implement GPay parser (refactor from sms-parser.js)
- [ ] Implement PhonePe parser (refactor from sms-parser.js)
- [ ] Implement Paytm parser (refactor from sms-parser.js)
- [ ] Implement BHIM parser (new)
- [ ] Write tests: 20+ notification examples per app
- [ ] Create `notification_log` table in schema

**Day 2: Standalone poller + dedup**
- [ ] Create `notification-poller.js` (separate from sms-poller)
- [ ] Implement three-tier dedup in `dedup.js`
- [ ] Wire notification poller into its own cron (every 2 min)
- [ ] Update HEARTBEAT.md to reference notification poller
- [ ] Test: simulate notifications, verify dedup works across
  SMS and notification channels

### Phase 2: Extended Parsers (2 days)

**Day 3: POS + Platform parsers**
- [ ] Implement Pine Labs parser
- [ ] Implement Razorpay parser
- [ ] Implement Petpooja parser
- [ ] Implement Instamojo parser
- [ ] Implement Swiggy Partner parser + platform accounting
- [ ] Implement Zomato Partner parser + platform accounting
- [ ] Write tests for each

**Day 4: Marketplace + Banking parsers**
- [ ] Implement Amazon Seller parser
- [ ] Implement Flipkart Seller parser
- [ ] Implement generic banking app parser
- [ ] Implement VPA resolver + vpa_map table
- [ ] Test platform order vs settlement reconciliation

### Phase 3: New Channels (2 days)

**Day 5: Forwarded messages + EOD reconciliation**
- [ ] Implement `forwarded-message-parser.js`
- [ ] Implement `eod-reconciliation.js` with multilingual templates
- [ ] Wire EOD into heartbeat (trigger at owner's closing time)
- [ ] Test EOD flow: confirm / different total / corrections

**Day 6: Bulk import + channel health**
- [ ] Implement `bulk-import.js` (passbook photo, PDF, CSV)
- [ ] Implement `channel-health.js` with multilingual alerts
- [ ] Wire health check into weekly heartbeat
- [ ] Test: import a bank passbook photo, verify batch processing

### Phase 4: Integration (1 day)

**Day 7: End-to-end testing**
- [ ] Full flow: notification + SMS for same UPI payment → dedup
- [ ] Full flow: Swiggy order → settlement → commission
- [ ] Full flow: voice cash entry + EOD reconciliation
- [ ] Full flow: passbook photo import + dedup against existing
- [ ] Full flow: channel health alert in Telugu, Hindi, English
- [ ] Measure: notification poll latency (<2 seconds)
- [ ] Measure: dedup accuracy (zero false positives on test set)

---

## How This Connects to the Business Brain

The data ingestion layer feeds the brain architecture:

```
[7 Channels] → transactions table → Brain reads transactions
                                      ↓
                                    Pattern detection
                                    (heartbeat cycle)
                                      ↓
                                    brain_entities (patterns)
                                    brain_edges (relationships)
                                    brain_observations (anomalies)
```

Without robust ingestion, the brain has nothing to think about.
With 7 channels, each backing up the others, we approach 90%+
capture. The remaining gap is caught by EOD reconciliation — the
owner's own count is always the final truth.

The confidence scores flow into the brain's observation system. A
transaction logged with confidence 0.60 from OCR generates an
observation: "Low-confidence transaction ₹3,200 from passbook photo
— owner should verify." The pre-response middleware ensures this
verification request actually reaches the owner.

The channel health monitor generates brain_observations about
systemic issues: "SMS channel has been silent for 48 hours — possible
DND issue." The morning briefing includes this if it persists.

The VPA resolver feeds back into brain_entities — each newly resolved
VPA adds knowledge about a customer's payment preferences, which
the agent uses for future interactions.

This is the data pipeline that makes everything else possible.
