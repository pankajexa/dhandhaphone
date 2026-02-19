---
name: sms-ledger
description: >
  Parses bank and UPI SMS messages into structured transactions.
  Automatically polls for new SMS. Maintains a local JSONL transaction
  ledger and running summary. Use when user asks about payments,
  revenue, expenses, balances, sales, income, or any financial query.
  Also triggers when reporting new transactions or payment events.
metadata:
  openclaw:
    emoji: "💰"
---

# SMS Transaction Ledger

## What This Skill Does
Automatically reads bank SMS and UPI app notifications from the AI
phone's SIM card, extracts financial transactions, and maintains a
local ledger. This is the primary source of truth for all money data.

## Transaction Ledger Location
- Monthly files: `workspace/ledger/YYYY-MM.jsonl` (one JSON per line)
- Running summary: `workspace/ledger/summary.json`

## How to Poll for New SMS
Run the poller script to check for new transactions:
```bash
node workspace/skills/sms-ledger/scripts/sms-poller.js
```
This is normally called by the sms-poll cron job every 5 minutes.
You can also run it manually if the user asks "check for new payments."

## How to Read Ledger Data

### Preferred: SQLite Database
Use the DB functions from `workspace/lib/utils.js`:
```javascript
const { getDB } = require('workspace/lib/utils');
const db = getDB();

// Today's summary
db.getDailySummary('2026-02-18');

// Filtered transactions
db.getTransactions({ type: 'credit', from_date: '2026-02-18', to_date: '2026-02-18' });

// Method breakdown for a period
db.getMethodBreakdown('2026-02-01', '2026-02-28');

// Top counterparties
db.getTopCounterparties('2026-02-01', '2026-02-28', 5);

// Revenue by day
db.getRevenueByDay('2026-02-01', '2026-02-28');

// Complex ad-hoc query (SELECT only)
db.agentQuery('SELECT counterparty_name, SUM(amount) as total FROM transactions WHERE type = ? AND transaction_date >= ? GROUP BY counterparty_name ORDER BY total DESC LIMIT 5', ['credit', '2026-02-01']);
```

### CLI query tool (uses DB with flat-file fallback)
```bash
node workspace/skills/sms-ledger/scripts/ledger-query.js --today --type credit
```

### Flat file fallback
- Read summary for quick stats: `cat workspace/ledger/summary.json`
- Read current month transactions: `cat workspace/ledger/YYYY-MM.jsonl`
- Search for specific transactions: `grep "SHARMA" workspace/ledger/2026-02.jsonl`

## Transaction Schema
Each line in the JSONL file:
```json
{
  "id": "txn_20260217_0001",
  "ts": "2026-02-17T10:30:00+05:30",
  "type": "credit",
  "amount": 5000,
  "counterparty": "SHARMA",
  "method": "UPI",
  "ref": "423567890",
  "bank": "HDFC",
  "acct_last4": "1234",
  "raw": "original SMS text...",
  "source": "sms",
  "category": null,
  "notes": null
}
```

## Summary Schema
```json
{
  "today": {"credits": 32400, "debits": 8200, "count": 15, "date": "2026-02-17"},
  "this_week": {"credits": 147200, "debits": 53000, "count": 72},
  "this_month": {"credits": 523000, "debits": 187000, "count": 312}
}
```

## Answering Financial Questions

When user asks about money:
1. **Preferred:** Use `db.getDailySummary()`, `db.getTransactions()`, etc.
2. Fallback: Read `workspace/ledger/summary.json` for quick answers
3. For detailed queries, use ledger-query.js or grep the JSONL file
4. Always respond with actual numbers from the data, not estimates
5. Format amounts in Indian style: ₹5,000 not $5000

Examples (user may ask in ANY Indian language — respond in same language):
- "Aaj kitna aaya?" / "Inniki evvalavu vandhudhu?" / "Today's revenue?" → Read summary.today.credits
- "Week ka total?" / "Ee vaaram total?" → Read summary.this_week
- "Sharma ne pay kiya?" → grep SHARMA in recent ledger entries
- "Kal ke transactions dikha" / "Ninnena transactions chupinchu" → filter by yesterday's date
- "Kitna kharch hua?" / "Evvalavu selavu?" / "How much spent?" → Read summary.today.debits

## Manual Transaction Entry
If user reports a cash transaction that won't appear in SMS:
- "Cash mein 2000 mila Mehta se" / "Mehta kitta 2000 cash kuduthar" / "Mehta gave 2000 cash"
→ Create a transaction entry with source: "manual" and method: "CASH"
→ Append to the JSONL ledger file directly:
```bash
echo '{"id":"txn_YYYYMMDD_XXXX","ts":"...","type":"credit","amount":2000,"counterparty":"MEHTA","method":"CASH","ref":null,"bank":null,"acct_last4":null,"raw":"manual entry","source":"manual","category":null,"notes":"Reported by owner via chat"}' >> workspace/ledger/YYYY-MM.jsonl
```
Then run the summary updater:
```bash
node workspace/skills/sms-ledger/scripts/rebuild-summary.js
```

## Voice Transaction Entry

When the owner speaks a transaction via voice note, the voice handler
(workspace/lib/voice/voice-handler.js) transcribes it and passes it
here as text. Handle these naturally:

- "Got fifteen thousand from Reddy for the order"
  → ₹15,000 credit from Reddy
- "Paid rent today, forty-two thousand"
  → ₹42,000 debit, category: rent
- "Three clients today, five thousand each"
  → ₹15,000 revenue (3 × ₹5,000)
- "Ravi nundi padi velu vachindi" (Telugu)
  → ₹10,000 credit from Ravi
- "Inniki moonu customer, total patinaiyaayiram" (Tamil)
  → ₹15,000 revenue

Voice parsing rules:
- Sarvam STT typically outputs numbers as digits ("5000")
- If amount or party is ambiguous: confirm before logging
  "₹15,000 from Reddy as credit? ✅ or ❌"
- Multiple transactions in one voice note: process each separately
- For voice-entered transactions, set source: "voice" (not "manual")

## OCR-Captured Transactions

When a transaction arrives with source: "ocr", it was extracted
from a photographed document by Sarvam Vision. Extra fields:
- `ocr_document_type`: "invoice", "receipt", "bank_statement"
- `ocr_vendor`: vendor name as read from document
- `ocr_invoice_no`: invoice number if present
- `ocr_items`: array of line items if present
- `notes`: includes reference to original photo

These transactions have already been confirmed by the owner
(doc-handler asks before logging). Treat them as reliable.

For bank statement imports (multiple transactions at once):
- Each transaction gets a separate ledger entry
- All share the same `batch_id` for reference
- Dedup against existing SMS-captured transactions
  (same amount + same date + same counterparty = skip)

## Important Notes
- SBI may not send credit SMS for all UPI transactions (only @sbi/@oksbi)
- HDFC skips SMS for small UPI transactions (<₹100 debit, <₹500 credit)
- The notification listener catches payments the SMS misses
- Never modify old ledger entries — append corrections as new entries
- Always update summary.json after adding transactions
