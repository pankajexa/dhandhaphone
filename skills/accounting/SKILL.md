---
name: accounting
description: >
  Categorizes transactions, generates Profit & Loss statements, tracks
  expenses by category, and provides business health metrics. Handles
  queries like "kitna profit hua", "expenses dikha", "P&L do", "category
  wise kharcha", "margin kya hai", "is mahine ka hisaab". Maintains
  category mappings and financial reports from ledger data.
metadata:
  openclaw:
    emoji: "📒"
---

# Accounting & Categorization

## What This Skill Does
Automatically categorizes every transaction in the ledger, maintains
running P&L statements, tracks expense/income by category, and answers
profitability questions. Turns raw transaction data into business insights.

## Data Locations

### Preferred: SQLite Database
Use DB functions from `workspace/lib/utils.js`:
```javascript
const { getDB } = require('workspace/lib/utils');
const db = getDB();

// Category management
db.getCategoryRules();
db.addCategoryRule({ category, match_type: 'keyword', match_value, priority });
db.categorizeTransaction(txn);          // auto-categorize
db.updateTransactionCategory(txnId, category);

// P&L and reports
db.getDateRangeSummary(from, to);       // income vs expenses
db.getMethodBreakdown(from, to);        // by payment method
db.saveMonthlyReport(month, 'pnl', data);
db.getMonthlyReport(month, 'pnl');

// Ad-hoc queries
db.agentQuery('SELECT category, SUM(amount) as total FROM transactions WHERE type = ? AND transaction_date BETWEEN ? AND ? AND is_deleted = 0 GROUP BY category ORDER BY total DESC', ['debit', '2026-02-01', '2026-02-28']);
```

### Flat file fallback
- Transaction ledger: `workspace/ledger/YYYY-MM.jsonl`
- Summary: `workspace/ledger/summary.json`
- Category rules: `workspace/accounting/categories.json`
- Monthly P&L: `workspace/accounting/pnl-YYYY-MM.json`

## Transaction Categories

### Income Categories
| Category | Trigger Keywords / Patterns |
|----------|---------------------------|
| `sales` | Customer payments, UPI received, cash sales |
| `platform-income` | Swiggy, Zomato, Amazon, Flipkart payouts |
| `pos-settlement` | POS terminal settlements |
| `interest` | Bank interest credits |
| `refund-received` | Refunds from suppliers |
| `other-income` | Anything else credited |

### Expense Categories
| Category | Trigger Keywords / Patterns |
|----------|---------------------------|
| `inventory-purchase` | Supplier payments, stock purchases |
| `rent` | Monthly rent, lease payments |
| `salary` | Staff payments, wages |
| `utilities` | Electricity, water, internet, phone |
| `transport` | Delivery, shipping, freight, logistics |
| `maintenance` | Repairs, AMC, servicing |
| `marketing` | Ads, promotions, signage |
| `gst-payment` | GST challan, tax payment |
| `bank-charges` | Service charges, penalties |
| `other-expense` | Anything else debited |

## Auto-Categorization Rules

When a new transaction is logged, categorize it:

1. **By counterparty match:** If counterparty is in contacts.json:
   - type=customer → category: `sales`
   - type=supplier → category: `inventory-purchase`
   - type=staff → category: `salary`

2. **By keyword match in raw SMS/notification:**
   - "rent", "lease" → `rent`
   - "salary", "wages" → `salary`
   - "electricity", "bijli", "BESCOM", "TSSPDCL" → `utilities`
   - "GST", "tax" → `gst-payment`
   - "Swiggy", "Zomato" → `platform-income`
   - "interest" → `interest`

3. **By method:**
   - method: "POS-SETTLEMENT" → `pos-settlement`
   - method: "PLATFORM" → `platform-income`

4. **Manual override:** Owner says "wo rent tha" → update category

5. **Uncategorized:** If no rule matches, set category to null.
   During EOD briefing, ask owner about uncategorized transactions.

## Category Rules File
`workspace/accounting/categories.json`:
```json
{
  "counterparty_rules": {
    "SHARMA": "sales",
    "GUPTA SUPPLIERS": "inventory-purchase",
    "BESCOM": "utilities"
  },
  "keyword_rules": [
    {"pattern": "rent|lease|kiraya", "category": "rent"},
    {"pattern": "salary|wages|tankhwah", "category": "salary"},
    {"pattern": "electric|bijli|BESCOM|TSSPDCL", "category": "utilities"},
    {"pattern": "GST|tax|challan", "category": "gst-payment"},
    {"pattern": "Swiggy|Zomato|Amazon|Flipkart", "category": "platform-income"},
    {"pattern": "interest|byaj", "category": "interest"},
    {"pattern": "delivery|transport|freight|shipping", "category": "transport"}
  ],
  "last_updated": "2026-02-18"
}
```

## P&L Statement

### Monthly P&L Schema
`workspace/accounting/pnl-YYYY-MM.json`:
```json
{
  "month": "2026-02",
  "income": {
    "sales": 320000,
    "platform-income": 45000,
    "pos-settlement": 28000,
    "interest": 500,
    "other-income": 2000,
    "total": 395500
  },
  "expenses": {
    "inventory-purchase": 187000,
    "rent": 15000,
    "salary": 35000,
    "utilities": 8000,
    "transport": 5000,
    "maintenance": 2000,
    "gst-payment": 12000,
    "bank-charges": 500,
    "other-expense": 3000,
    "total": 267500
  },
  "gross_profit": 128000,
  "gross_margin_pct": 32.4,
  "uncategorized_count": 3,
  "generated_at": "2026-02-18T09:00:00+05:30"
}
```

## How to Generate P&L

1. Read all entries from `workspace/ledger/YYYY-MM.jsonl`
2. Group by category (use categories.json for uncategorized ones)
3. Sum credits by income category, debits by expense category
4. Calculate gross profit = total income - total expenses
5. Calculate margin % = (gross profit / total income) × 100
6. Write to `workspace/accounting/pnl-YYYY-MM.json`

## Answering Financial Questions

### "Kitna profit hua?" / "Evvalavu laaabam?" / "What's the profit?"
1. Read current month's P&L (or generate if stale)
2. Report gross profit and margin
3. Respond in owner's language: "This month ₹1,28,000 profit, 32% margin. 8% more than last month."

### "Expenses dikha" / "Selavu enna?" / "Show expenses"
1. Read P&L, list expense categories sorted by amount
2. "Top expenses: Stock purchase ₹1,87,000 | Salary ₹35,000 | Rent ₹15,000"

### "Category wise batao" / "Category wise cheppu"
1. Show full P&L breakdown in simple format
2. Use emojis for visual clarity

### "Is mahine ka P&L do" / "Ee month P&L ivvu" / "This month's P&L"
1. Generate fresh P&L from ledger
2. Format as clean report with income/expense/profit sections

### "Pichle mahine se compare karo" / "Last month compare cheyyi"
1. Read both months' P&L files
2. Calculate % change for each category and total
3. Highlight biggest changes

## Recategorization
When the owner corrects a category:
- "Wo SHARMA wala payment rent tha, sale nahi"
→ Update the transaction's category in the JSONL
→ Regenerate P&L
→ Update counterparty rule in categories.json for future

## Weekly P&L in Briefings
The weekly report (Sunday 8 PM) should include a mini P&L:
- Week's income vs expenses
- Top 3 expense categories
- Margin trend (up/down from last week)

## Examples

**User:** "profit kitna hua is mahine?" / "ee month laaabam evvalavu?"
**Action:** Generate/read P&L for current month
**Response (in user's language):** "February so far: ₹1,28,000 profit. Income ₹3,95,500, expenses ₹2,67,500. Margin 32%."

**User:** "sabse zyada kharcha kahan?" / "highest expense enna?"
**Action:** Read P&L, sort expenses descending
**Response:** "Top 3: Stock purchase ₹1,87,000 (70%) | Salary ₹35,000 (13%) | Rent ₹15,000 (6%)"

**User:** "that 5000 was electricity"
**Action:** Find recent ₹5,000 debit, update category to utilities
**Response:** "Done — ₹5,000 moved to utilities."

**User:** "January se compare karo" / "compare with January"
**Action:** Read Jan and Feb P&L
**Response:** "Feb vs Jan: Income 12% up, Expenses 8% up, Profit 18% up. Great growth! 💪"
