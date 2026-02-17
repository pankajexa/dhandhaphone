---
name: credit-manager
description: >
  Tracks udhaar (credit/receivables) with escalating reminder system.
  Manages who owes how much, for how long, and sends progressively
  stronger payment reminders. Handles queries like "kaun kitna deta hai",
  "Sharma ka udhaar kitna hai", "reminder bhejo", "udhaar maaf karo",
  "payment plan banao". Essential for Indian SMBs where 30-50% of sales
  are on credit.
metadata:
  openclaw:
    emoji: "💳"
---

# Credit Manager (Udhaar Tracker)

## What This Skill Does
Tracks all credit given to customers (udhaar/receivables) and payments
owed to suppliers. Sends escalating payment reminders — gentle at first,
firmer over time. Generates aging reports and helps recover overdue money.
This is critical for Indian SMBs where udhaar is the norm.

## Data Locations
- Contacts (with balances): `workspace/contacts/contacts.json`
- Pending actions: `workspace/pending/actions.json`
- Reminder log: `workspace/pending/reminders.jsonl`
- Transaction ledger: `workspace/ledger/YYYY-MM.jsonl`

## Udhaar Dashboard

When asked "kaun kitna deta hai" or "udhaar list":

1. Read contacts.json
2. Filter contacts where balance > 0 (they owe us)
3. Sort by balance descending
4. Calculate days overdue from last_interaction or oldest pending action
5. Format as dashboard:

```
💳 Udhaar Dashboard:
1. Sharma ji: ₹15,000 (5 din se) ⚠️
2. Mehta: ₹8,000 (3 din se)
3. Patel: ₹3,500 (1 din se)
4. Reddy: ₹2,000 (aaj ka)
━━━━━━━━━━━━━━━━━━━━
Total receivable: ₹28,500 (4 log)
```

## Escalating Reminder System

### Reminder Levels
| Level | Days Overdue | Tone | Example |
|-------|-------------|------|---------|
| 0 | Due today | Informational | "Aaj payment due hai" |
| 1 | 1-3 days | Gentle | "Payment ka yaad dila raha tha..." |
| 2 | 4-7 days | Polite but firm | "Payment abhi tak pending hai..." |
| 3 | 8-14 days | Firm | "Kaafi din ho gaye, payment kar dijiye..." |
| 4 | 15-30 days | Serious | "₹X bahut din se pending hai, please settle karein" |
| 5 | 30+ days | Final | "Bahut time ho gaya, yeh matter resolve karna zaroori hai" |

### Reminder Message Templates
Draft reminders in the CUSTOMER's language (ask owner if unsure).
Below are tone guidelines — adapt to the appropriate language.

**Level 1 (1-3 days) — Gentle:**
```
Greetings {name} 🙏
A quick reminder — ₹{amount} payment has been pending for {days} days.
Please make the payment at your convenience. Thank you!
```

**Level 2 (4-7 days) — Polite but firm:**
```
{name}, ₹{amount} payment is pending for {days} days.
When can we expect it? Please let us know so we can note it down.
```

**Level 3 (8-14 days) — Firm:**
```
{name}, ₹{amount} has been pending for {days} days now.
We need to maintain our cash flow as well.
Please make the payment at the earliest. 🙏
```

**Level 4 (15-30 days) — Serious:**
```
{name}, ₹{amount} payment is now {days} days overdue.
It's important to settle this amount.
If there's any issue, please let us know — we can work out a plan.
```

**Level 5 (30+ days) — Final:**
```
{name}, ₹{amount} has been pending for a very long time ({days} days).
This matter needs to be resolved now. Please get in touch today.
```

NOTE: These templates are language-neutral guides. The actual message
MUST be drafted in the customer's language — Hindi, Tamil, Telugu,
Kannada, Bengali, Marathi, Gujarati, etc. Use culturally appropriate
honorifics and tone for each language.

### IMPORTANT: Owner Approval
NEVER send reminders automatically. Always:
1. Draft the reminder
2. Show to owner with inline keyboard: [✅ Send] [✏️ Edit] [❌ Skip]
3. Only send after owner approves
4. Log the reminder in reminders.jsonl

## Reminder Log
`workspace/pending/reminders.jsonl`:
```json
{"ts":"2026-02-18T10:00:00+05:30","contact_id":"C-001","contact_name":"Sharma ji","amount":15000,"level":2,"status":"sent","message":"..."}
```
Status: `drafted` → `sent` / `skipped` / `edited`

## Auto-Escalation Schedule
During morning briefing, check all overdue receivables:
1. Calculate days overdue for each
2. Determine appropriate reminder level
3. If level increased since last reminder → suggest new reminder
4. Show owner: "Sharma ji ka ₹15,000 ab 8 din se pending — Level 3 reminder bhejein?"

## Payment Plans
If owner says "Sharma ko installment do":
1. Create a payment plan:
```json
{
  "contact_id": "C-001",
  "total": 15000,
  "installments": [
    {"amount": 5000, "due": "2026-02-25", "status": "pending"},
    {"amount": 5000, "due": "2026-03-04", "status": "pending"},
    {"amount": 5000, "due": "2026-03-11", "status": "pending"}
  ]
}
```
2. Track each installment separately
3. Send reminders per installment

## Supplier Payables
Also track what WE owe (contacts with balance < 0):
```
📋 Humein dena hai:
1. Gupta Suppliers: ₹35,000 (credit: 15 din)
2. Raj Cement: ₹22,000 (credit: 10 din)
━━━━━━━━━━━━━━━━━━━━
Total payable: ₹57,000
```

Alert when supplier payment is approaching credit term deadline.

## Credit Limit Management
If owner sets credit limits:
- "Sharma ko 20,000 se zyada udhaar mat dena"
- Store in contact notes
- Warn when new order would exceed limit:
  "⚠️ Sharma ji ka already ₹15,000 pending hai. Naya ₹8,000 order se
  ₹23,000 ho jayega — limit ₹20,000 hai. Allow karein?"

## Aging Report
Generate on demand or weekly:
```
📊 Udhaar Aging Report:
0-3 days:   ₹5,500  (2 log) — fresh
4-7 days:   ₹8,000  (1 log) — follow up
8-14 days:  ₹15,000 (1 log) ⚠️ overdue
15-30 days: ₹0
30+ days:   ₹0
━━━━━━━━━━━━━━━━━━━━
Total: ₹28,500
Collection rate (this month): 78%
```

## Integration with Other Skills
- **sms-ledger:** When payment received, auto-reduce customer balance
- **business-memory:** Contact balance updates flow both ways
- **business-briefing:** Include top overdue items in morning/EOD
- **accounting:** Receivables affect cash flow projections

## Examples

**User:** "Sharma ka kitna baaki hai?" / "Sharma evvalavu pending?" / "How much does Sharma owe?"
**Response (in user's language):** "Sharma — ₹15,000 pending, 5 days. Send reminder?"

**User:** "Yes, send reminder"
**Action:** Draft Level 2 reminder in customer's language, show for approval
**Response:** "Send this to Sharma?
'Sharma ji, ₹15,000 payment is pending for 5 days. When can we expect it?'
[✅ Send] [✏️ Edit] [❌ Skip]"

**User:** "Sabka udhaar dikha" / "Show all credit" / "Ellaarum evvalavu kudukkanam?"
**Action:** Read contacts, filter balance > 0, sort descending
**Response:** Full udhaar dashboard (see above)

**User:** "Patel ka 3000 maaf karo" / "Write off Patel's 3000"
**Action:** Reduce Patel balance by 3000, add note
**Response:** "Done — Patel ₹3,000 written off. Remaining ₹500."

**User:** "Mehta ko 3 installment do" / "Give Mehta 3 installments"
**Action:** Create 3-part payment plan for Mehta's balance
**Response:** "Payment plan created — ₹8,000 / 3 = ₹2,667 per week.
First installment 25 Feb. Reminders auto-set."

**User:** "Kaun late hai?" / "Yaaru late?" / "Who's late?"
**Action:** Show aging report
**Response:** "Sharma ₹15,000 (5 days) ⚠️ most overdue. Rest all within 3 days."
