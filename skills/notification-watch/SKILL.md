---
name: notification-watch
description: >
  Monitors Android notifications from UPI apps (GPay, PhonePe, Paytm),
  POS systems (BountiPOS, Pine Labs), food delivery apps (Swiggy, Zomato),
  e-commerce (Amazon, Flipkart), and payment gateways (Razorpay, Instamojo).
  Captures transactions that bank SMS misses — especially small UPI payments,
  online orders, and POS settlements. Use when user asks about app payments,
  online orders, delivery platform earnings, or missing transactions.
metadata:
  openclaw:
    emoji: "🔔"
    requires:
      bins: ["termux-notification-list"]
---

# Notification Watch

## What This Skill Does
Polls Android notifications via Termux:API and extracts financial events
that bank SMS may miss. SBI skips SMS for many UPI handles, HDFC skips
small transactions — this skill catches what SMS misses by reading
notifications from UPI apps, POS terminals, food delivery, and e-commerce.

## Data Sources
- `termux-notification-list` — all active Android notifications (JSON)
- `workspace/sms/last_notification_id.txt` — deduplication marker

## How to Poll Notifications
```bash
# Get current notifications
termux-notification-list

# Or via proot bridge
/host-rootfs/data/data/com.termux/files/usr/bin/termux-notification-list
```

## Supported App Packages

### UPI Payment Apps
| Package | App | Extracts |
|---------|-----|----------|
| `com.google.android.apps.nbu.paisa` | Google Pay | received/sent, amount, counterparty |
| `com.phonepe.app` | PhonePe | received/sent, amount, counterparty |
| `net.one97.paytm` | Paytm | received, amount, counterparty |
| `in.org.npci.upiapp` | BHIM | received/sent, amount, ref |

### POS & Payment Gateways
| Package | App | Extracts |
|---------|-----|----------|
| `com.bountipos.*` | BountiPOS | sale amount, payment mode, order ID |
| `com.pinelabs.masterapp` | Pine Labs | settlement, txn count, amount |
| `com.razorpay.*` | Razorpay | payment received, amount, order ID |
| `com.instamojo.*` | Instamojo | payment link paid, amount |

### Food Delivery & E-commerce
| Package | App | Extracts |
|---------|-----|----------|
| `in.swiggy.android` | Swiggy (merchant) | new order, amount, order ID |
| `com.application.zomato` | Zomato (merchant) | new order, amount, settlement |
| `in.amazon.mShop.android.shopping` | Amazon Seller | order, amount |
| `com.flipkart.android` | Flipkart Seller | order, payout |

## Notification Parsing Rules

### Google Pay
```
title: "Payment received" → type: credit
content: "₹5,000 received from Rajesh Kumar"
→ amount: 5000, counterparty: "Rajesh Kumar", method: "UPI-GPay"

title: "Payment sent" → type: debit
content: "₹12,000 sent to Gupta Suppliers"
→ amount: 12000, counterparty: "Gupta Suppliers", method: "UPI-GPay"
```

### PhonePe
```
title: "Received ₹5,000" → type: credit
content: "From Rajesh Kumar to your bank account"
→ amount: 5000, counterparty: "Rajesh Kumar", method: "UPI-PhonePe"

title: "Paid ₹12,000" → type: debit
content: "To Gupta Suppliers from your bank account"
→ amount: 12000, counterparty: "Gupta Suppliers", method: "UPI-PhonePe"
```

### Paytm
```
title: "₹5,000 received" → type: credit
content: "Payment from Rajesh Kumar"
→ amount: 5000, counterparty: "Rajesh Kumar", method: "UPI-Paytm"
```

### Swiggy (Merchant App)
```
title: "New Order #SW1234"
content: "Order worth ₹450 from Swiggy"
→ type: credit, amount: 450, counterparty: "Swiggy", method: "PLATFORM", ref: "SW1234"
```

### Zomato (Merchant App)
```
title: "New Order"
content: "₹380 order received - Zomato"
→ type: credit, amount: 380, counterparty: "Zomato", method: "PLATFORM", ref from ID
```

### BountiPOS / POS Terminals
```
title: "Sale Completed"
content: "₹2,500 received via Card"
→ type: credit, amount: 2500, method: "CARD-POS"

title: "Settlement"
content: "₹15,000 settled for 12 transactions"
→ type: credit, amount: 15000, method: "POS-SETTLEMENT"
```

## Deduplication
Notifications can duplicate with bank SMS. Before logging:
1. Check if a transaction with same amount ± same counterparty exists
   in the last 10 minutes of ledger entries
2. If match found → skip (SMS already captured it)
3. If no match → log as new transaction with source: "notification"
4. Store the notification key in `workspace/sms/last_notification_id.txt`

## Transaction Logging
When a valid financial notification is found:
```bash
# Append to ledger
echo '{"id":"txn_YYYYMMDD_XXXX","ts":"...","type":"credit","amount":5000,"counterparty":"RAJESH","method":"UPI-GPay","ref":null,"bank":null,"acct_last4":null,"raw":"notification text","source":"notification","category":null,"notes":null}' >> workspace/ledger/YYYY-MM.jsonl
```
Then update summary:
```bash
node workspace/skills/sms-ledger/scripts/rebuild-summary.js
```

## Heartbeat Integration
The notification poller runs every 5 minutes alongside the SMS poller.
During heartbeat, any high-value notification (>₹5,000) triggers an
immediate alert to the owner via Telegram.

## Alerts
Notify the owner immediately for:
- Large payments received (>₹5,000)
- POS settlement completed
- Food delivery platform payouts
- Failed payment notifications

Do NOT alert for:
- Promotional notifications
- App update notifications
- Chat/social notifications
- Repeat of already-captured SMS transactions

## Examples

**Notification from GPay: "Payment received - ₹8,000 from Sharma"**
→ Check ledger for recent ₹8,000 from SHARMA
→ If not found: log as credit, source: "notification", method: "UPI-GPay"
→ Alert owner (in their language): "₹8,000 received from Sharma (GPay) ✅"

**Notification from Swiggy: "New Order #SW5678 worth ₹320"**
→ Log as credit, ₹320, counterparty: "Swiggy", ref: "SW5678"
→ No alert (below threshold)

**Notification from Pine Labs: "Settlement ₹25,000 for 18 txns"**
→ Log as credit, ₹25,000, method: "POS-SETTLEMENT"
→ Alert owner (in their language): "POS settlement received — ₹25,000 (18 txns) ✅"
