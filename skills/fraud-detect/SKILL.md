---
name: fraud-detect
description: >
  Detects anomalous transactions using 3-layer analysis: velocity checks,
  amount anomalies, and pattern breaks. Flags duplicate payments, unusual
  timing, amounts outside normal range, and suspicious counterparties.
  Alerts owner immediately for high-confidence fraud, flags for review
  otherwise. Use when checking transaction safety or investigating
  suspicious activity.
metadata:
  openclaw:
    emoji: "🛡️"
---

# Fraud Detection

## What This Skill Does
Monitors every transaction for anomalies using a 3-layer detection system.
Flags suspicious activity, alerts the owner, and maintains a fraud log.
Designed for Indian SMB transaction patterns — catches duplicate UPI
charges, fake SMS scams, unusual amounts, and timing anomalies.

## Data Locations
- Transaction ledger: `workspace/ledger/YYYY-MM.jsonl`
- Fraud alerts log: `workspace/accounting/fraud-alerts.jsonl`
- Baseline stats: `workspace/accounting/txn-baseline.json`

## 3-Layer Detection System

### Layer 1: Velocity Checks (Real-time)
Run on EVERY new transaction as it's logged.

| Check | Rule | Action |
|-------|------|--------|
| Duplicate amount | Same amount + same counterparty within 5 minutes | 🔴 Alert: likely duplicate charge |
| Rapid fire | >5 debits within 10 minutes | 🔴 Alert: possible unauthorized access |
| Same-amount burst | Same exact amount debited 3+ times in 1 hour | 🟡 Flag: review needed |
| Night transactions | Debit between 12 AM - 5 AM IST | 🟡 Flag: unusual timing |
| Weekend large debit | Debit >₹10,000 on Sunday | 🟡 Flag: review if expected |

### Layer 2: Amount Anomalies (Per-transaction)
Compare each transaction against the owner's baseline.

| Check | Rule | Action |
|-------|------|--------|
| Unusually large | Amount > 3× average transaction for same type | 🟡 Flag: verify |
| Round number large debit | Exact round number >₹50,000 debit | 🟡 Flag: verify intent |
| New counterparty + large | First-time counterparty + amount >₹10,000 | 🟡 Flag: new party, large amount |
| Amount mismatch | Credit ≠ expected amount from pending action | 🟡 Flag: partial or wrong payment |

### Layer 3: Pattern Breaks (Daily analysis)
Run during heartbeat or EOD to catch longer-term anomalies.

| Check | Rule | Action |
|-------|------|--------|
| Revenue drop | Today's credits < 50% of 7-day average | 🟡 Note in EOD briefing |
| Expense spike | Today's debits > 2× 7-day average | 🟡 Note in EOD briefing |
| Missing expected | Regular daily customer didn't transact | ℹ️ Mention if pattern broken for 3+ days |
| New recurring debit | Same amount debited weekly (subscription?) | ℹ️ Ask owner if intentional |
| Counterparty frequency | Sudden increase in txns with one party | 🟡 Flag: unusual activity |

## Baseline Stats
`workspace/accounting/txn-baseline.json`:
```json
{
  "avg_daily_credits": 15000,
  "avg_daily_debits": 8000,
  "avg_credit_amount": 2500,
  "avg_debit_amount": 3000,
  "max_normal_credit": 25000,
  "max_normal_debit": 20000,
  "usual_active_hours": {"start": 7, "end": 22},
  "regular_counterparties": ["SHARMA", "GUPTA", "MEHTA", "PATEL"],
  "last_recalculated": "2026-02-18"
}
```

Recalculate baseline weekly from last 30 days of ledger data.
For new businesses (< 30 days data), use conservative defaults.

## Alert Levels

### 🔴 RED — Immediate Alert
Send Telegram message NOW with inline keyboard:
```
🚨 ALERT: Possible duplicate charge!
₹5,000 debited TWICE to SHARMA in 3 minutes.
UPI refs: 123456, 123457

[✅ Expected] [❌ Report to bank] [🔍 Show details]
```

### 🟡 YELLOW — Flag for Review
Include in next briefing or EOD summary:
```
⚠️ Review: ₹75,000 debit to new party "ABC TRADERS" at 11 PM.
Normal? Reply "haan" to clear.
```

### ℹ️ INFO — Pattern Note
Include in weekly report only:
```
Note: Sharma ji ne 3 din se koi payment nahi kiya (normally daily).
```

## Fraud Alerts Log
`workspace/accounting/fraud-alerts.jsonl`:
```json
{"ts":"2026-02-18T10:30:00+05:30","level":"red","type":"duplicate","txn_id":"txn_20260218_0042","amount":5000,"counterparty":"SHARMA","detail":"Same amount+party within 5 min","status":"pending","resolved_at":null,"resolution":null}
```

Status: `pending` → `cleared` (false alarm) or `confirmed` (real issue)

## Fake SMS Detection
Indian businesses are heavily targeted by fake bank SMS. Flag if:
- SMS sender is not a known bank sender ID (HDFCBK, SBI, ICICIB, etc.)
- SMS contains a link (banks NEVER include links in transaction SMS)
- SMS asks for OTP, PIN, or password
- SMS mentions "KYC update" or "account blocked"
- Amount seems fabricated (not matching any recent transaction)

When detected (alert in owner's language):
```
🚨 FAKE SMS detected!
"Your SBI account credited ₹50,000. Click link to verify."
Real banks NEVER send links in SMS. IGNORE this message.
```

## How to Run Fraud Checks

### On New Transaction (called by sms-poller/notification-watch)
1. Read the new transaction
2. Run Layer 1 velocity checks against last 20 ledger entries
3. Run Layer 2 amount checks against baseline
4. If any flag triggered → log to fraud-alerts.jsonl
5. If RED alert → send Telegram message immediately
6. If YELLOW → queue for next briefing

### On Heartbeat (every 30 min)
1. Run Layer 3 pattern analysis on today's transactions
2. Compare against 7-day rolling averages
3. Log any anomalies

### On EOD (9 PM)
1. Summarize any flags from the day
2. Include in EOD briefing if any YELLOW or RED alerts
3. Recalculate baseline if last update > 7 days

## Owner Resolution
When owner responds to an alert (in any language):
- Affirmative ("yes", "haan", "sahi", "amaam", "avunu", "howdu") → Mark as cleared
- Negative ("no", "nahi", "wrong", "illa", "kaadu", "alla") → Mark as confirmed, suggest contacting bank
- Bank contact request → Provide bank helpline numbers

### Bank Helplines (Quick Reference)
| Bank | Helpline |
|------|----------|
| HDFC | 1800-266-4332 |
| SBI | 1800-11-2211 |
| ICICI | 1800-1080 |
| Axis | 1860-419-5555 |
| Kotak | 1860-266-2666 |

## Examples

**Duplicate detected (respond in owner's language):**
"🚨 ₹5,000 sent to Sharma TWICE in 3 minutes! Looks like a duplicate.
Call the bank? HDFC helpline: 1800-266-4332"

**Large unusual debit:**
"⚠️ ₹75,000 sent to 'NEW TRADERS' at 11 PM. First time seeing this name.
Is this correct? Reply yes or no."

**Fake SMS caught:**
"🚨 This SMS is FAKE! Banks never send links in SMS. Ignore it.
Real HDFC SMS sender: HDFCBK."

**Revenue pattern break:**
"📊 Only ₹4,200 received today — normally ₹15,000 average. Any issues?
If all fine, just ignore."
