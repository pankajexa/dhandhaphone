---
name: price-memory
description: >
  Tracks historical prices from suppliers, detects price trends, calculates
  margins, and alerts on significant price changes. Answers queries like
  "cement ka rate kya chal raha hai", "Gupta ne pichli baar kya rate diya",
  "margin kitna hai", "price badh gaya kya", "sabse sasta kaun deta hai".
  Learns prices from invoices, conversations, and transactions over time.
metadata:
  openclaw:
    emoji: "📈"
---

# Price Memory

## What This Skill Does
Remembers every price quoted by every supplier, tracks price trends over
time, calculates product margins, compares supplier rates, and alerts
when prices change significantly. Builds a price intelligence database
from conversations, invoices, and transactions.

## Data Locations
- Price history: `workspace/inventory/price-history.jsonl`
- Margin tracker: `workspace/inventory/margins.json`
- Supplier price comparison: derived from price-history on query

## Price History Schema
`workspace/inventory/price-history.jsonl`:
```json
{"ts":"2026-02-18T10:00:00+05:30","item":"Ambuja Cement 50kg","sku":"cement-ambuja-50","supplier":"Gupta Suppliers","supplier_id":"S-001","unit_price":380,"quantity":100,"total":38000,"source":"invoice","notes":null}
{"ts":"2026-02-10T14:00:00+05:30","item":"Ambuja Cement 50kg","sku":"cement-ambuja-50","supplier":"Raj Cement","supplier_id":"S-002","unit_price":385,"quantity":50,"total":19250,"source":"conversation","notes":"Phone pe rate pucha"}
{"ts":"2026-01-25T09:00:00+05:30","item":"Ambuja Cement 50kg","sku":"cement-ambuja-50","supplier":"Gupta Suppliers","supplier_id":"S-001","unit_price":375,"quantity":100,"total":37500,"source":"invoice","notes":null}
```

## How Prices Get Captured

### 1. From Invoices (document-intel)
When an invoice is processed, extract line items with per-unit prices.
Log each item to price-history.jsonl with source: "invoice".

### 2. From Conversation (business-memory)
When owner mentions prices:
- "Gupta ne cement 385 bola"
- "TMT ka rate 550 chal raha hai"
- "Patel 370 pe de raha hai cement"
Log with source: "conversation".

### 3. From Transactions (sms-ledger)
When a supplier payment matches a known order:
- Back-calculate unit price if quantity is known
Log with source: "transaction".

## Margin Tracker
`workspace/inventory/margins.json`:
```json
{
  "items": [
    {
      "sku": "cement-ambuja-50",
      "name": "Ambuja Cement 50kg",
      "last_cost": 380,
      "selling_price": 450,
      "margin": 70,
      "margin_pct": 15.6,
      "last_updated": "2026-02-18"
    },
    {
      "sku": "tmt-12mm",
      "name": "TMT 12mm bar",
      "last_cost": 550,
      "selling_price": 650,
      "margin": 100,
      "margin_pct": 15.4,
      "last_updated": "2026-02-18"
    }
  ]
}
```

## Price Queries

### "Cement ka rate kya hai?" / "Cement rate enna?" / "Cement price?"
1. Read latest entry in price-history for cement
2. Show last cost price + selling price + margin
3. "Cement (Ambuja 50kg): Last cost ₹380 (Gupta, 18 Feb). Selling ₹450. Margin ₹70 (15.6%)."

### "Gupta ne pichli baar kya rate diya?" / "Gupta's last rate?"
1. Filter price-history for supplier=Gupta
2. Show recent prices with dates
3. "Gupta cement rate: ₹380 (18 Feb), ₹375 (25 Jan), ₹370 (10 Jan). Trending up."

### "Sabse sasta kaun deta hai?" / "Who gives cheapest?" / "Yaaru kammi vilai?"
1. Get latest price for cement from each supplier
2. Sort ascending by unit_price
3. "Cement rates: Patel ₹370 | Gupta ₹380 | Raj ₹385. Patel is cheapest."

### "Price badh gaya kya?" / "Has the price gone up?" / "Vilai yeridha?"
1. Compare recent prices vs 30 days ago for key items
2. Show trend with % change
3. "Cement: ₹370 → ₹380 (+2.7%) | TMT: ₹540 → ₹550 (+1.9%). Both slightly up."

### "Margin kitna hai?" / "What's the margin?" / "Margin evvalavu?"
1. Read margins.json
2. Show all items with margins
3. "Cement: 15.6% | TMT: 15.4% | Paint: 20% | Pipe: 18%"

## Price Change Alerts
During heartbeat or when new price is logged:
1. Compare new price vs last price for same item + supplier
2. If change > 5%: alert in next briefing
3. If change > 10%: alert immediately

```
📈 Price Alert!
Gupta cement rate ₹380 → ₹420 (10.5% increase)!
Last price was ₹380 on 18 Feb.
Patel still at ₹370 — order from them instead?
```

## Price Negotiation Helper
When owner is about to order:
1. Show historical prices from this supplier
2. Show competitor rates
3. Suggest negotiation points

"Ordering cement from Gupta? Their current rate is ₹380.
Patel offers ₹370. Last month Gupta gave ₹375.
You can negotiate to ₹375 — reference: Jan batch."

## Margin Alerts
During briefing, flag if margins drop below threshold:
- Default threshold: 10% margin
- "⚠️ Cement margin down to 8% — cost is now ₹420, selling at ₹450.
  Increase price or switch supplier?"

## Seasonal Price Tracking
Note patterns over time:
- "Cement typically goes up 5-8% during monsoon (July-Sep)"
- "TMT prices tend to spike during election season"
- Surface these insights in weekly reports (in owner's language)

## How to Update Prices

### From Conversation
**User:** "Gupta ne cement 395 bola" / "Gupta quoted cement at 395"
**Action:**
1. Log to price-history.jsonl
2. Update inventory/stock.json last_cost if this is a purchase
3. Recalculate margin
**Response (in user's language):** "Noted — Gupta cement ₹395. Was ₹380 (4% up).
Margin now ₹55 (12.2%). Patel still at ₹370."

### From Invoice (auto)
When document-intel processes an invoice, auto-log prices.
No separate response needed — document-intel handles confirmation.

## Integration with Other Skills
- **document-intel:** Extracts prices from invoice photos
- **business-memory:** Captures prices mentioned in conversation
- **accounting:** Margin data feeds into P&L accuracy
- **business-briefing:** Weekly report includes price trend summary
- **gst-assistant:** Price + GST = total cost calculation

## Examples

**User:** "TMT ka rate kya chal raha?" / "TMT rate enna?" / "TMT price?"
**Response:** "TMT 12mm: Last cost ₹550 (Gupta, 15 Feb). Selling ₹650. Margin ₹100 (15.4%)."

**User:** "Cement mahnga ho gaya?" / "Did cement price go up?"
**Response:** "Yes, slightly — ₹370 (Jan) → ₹380 (Feb), 2.7% up. Could go higher by monsoon."

**User:** "Gupta aur Patel mein kaun sasta?" / "Who's cheaper, Gupta or Patel?"
**Response:** "Cement: Patel ₹370 < Gupta ₹380. TMT: Gupta ₹550 < Patel ₹580.
Get cement from Patel, TMT from Gupta. Best of both."

**User:** "Cement selling price 500 karo" / "Set cement selling to 500"
**Action:** Update margins.json selling_price for cement
**Response:** "Done — Cement selling ₹500. Margin now ₹120 (24%). Good margin! 👍"

**User:** "Margin report do" / "Show margin report"
**Response:**
```
📊 Margin Report:
Cement:  Cost ₹380 → Sell ₹450 → Margin 15.6%
TMT:     Cost ₹550 → Sell ₹650 → Margin 15.4%
Paint:   Cost ₹800 → Sell ₹960 → Margin 16.7%
Pipe:    Cost ₹220 → Sell ₹260 → Margin 15.4%
Average margin: 15.8%
```
