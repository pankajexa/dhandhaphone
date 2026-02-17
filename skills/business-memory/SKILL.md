---
name: business-memory
description: >
  Manages business contacts, inventory, and pending actions.
  Silently extracts business data from every conversation — contacts,
  stock updates, orders, deliveries, payments owed/received.
  Use when user mentions any person, product, order, delivery,
  stock level, payment due, or business relationship. Also handles
  queries like "who owes me", "stock kitna hai", "Gupta ka last order".
metadata:
  openclaw:
    emoji: "🧠"
---

# Business Memory

## What This Skill Does
Remembers EVERYTHING the owner tells you about their business. Silently
extracts contacts, inventory changes, and pending actions from natural
conversation. Updates workspace files automatically. Provides instant
lookup when asked.

## Data Locations
- Contacts: `workspace/contacts/contacts.json`
- Inventory: `workspace/inventory/stock.json`
- Pending Actions: `workspace/pending/actions.json`
- Contact Lookup Script: `workspace/skills/business-memory/scripts/contact-lookup.js`

## CRITICAL: Silent Data Extraction

When the owner says ANYTHING about their business, extract data WITHOUT
being asked. They will never say "add Gupta to contacts." They'll say
something like "Gupta ka delivery aaya, 50 bags, 19000 ka invoice" or
"Gupta delivery vandhuduchu, 50 bags, 19000 bill" or "Gupta delivery
aayindi, 50 bags, 19000 invoice." Understand business intent in ANY
Indian language. YOU must:

1. Check if "Gupta" exists in contacts.json
   - If yes: update last_interaction, adjust balance (+19000 payable)
   - If no: create new supplier entry with next available ID
2. Update inventory (stock +50 bags if item exists, create item if not)
3. Log the payable in pending/actions.json
4. Update summary if financial impact

Then confirm BRIEFLY in the user's language:
- "Got it — Gupta se 50 bags mila, ₹19,000 payable. Cement stock now 62 bags."
- "Gupta kitta 50 bags vandhudhu, ₹19,000 kodakkanam. Cement stock ippo 62 bags."
- "Noted — Gupta nundi 50 bags vachindi, ₹19,000 payable. Cement stock 62 bags."

Do NOT give a long-winded response. Business owners want confirmation,
not conversation.

## Contact Schema
```json
{
  "id": "C-001",
  "name": "Sharma ji",
  "type": "customer",
  "phone": "+919876543210",
  "balance": 15000,
  "last_interaction": "2026-02-17",
  "notes": "Hardware store owner, Begumpet. Usually orders cement and TMT bars."
}
```

**Balance convention:**
- Positive = they owe us (receivable)
- Negative = we owe them (payable)

**ID convention:**
- Customers: C-001, C-002, ...
- Suppliers: S-001, S-002, ...
- Staff: E-001, E-002, ...

## Inventory Schema
```json
{
  "name": "Ambuja Cement 50kg",
  "sku": "cement-ambuja-50",
  "quantity": 12,
  "unit": "bags",
  "reorder_point": 10,
  "typical_daily": 8,
  "last_cost": 380,
  "last_updated": "2026-02-17T14:30:00+05:30"
}
```

## Pending Actions Schema
```json
{
  "id": "act-001",
  "type": "payment_reminder",
  "target_contact_id": "C-001",
  "amount": 15000,
  "due_date": "2026-02-12",
  "status": "pending",
  "created": "2026-02-17",
  "notes": "5 days overdue"
}
```

Action types: `payment_reminder`, `delivery_expected`, `order_followup`,
`restock_needed`, `custom`

## How to Update Contacts

1. Read current contacts.json
2. Search for matching name (fuzzy — "Sharma", "Sharma ji", "sharma" all match)
3. If found: update fields (balance, last_interaction, notes)
4. If not found: create new entry with next available ID
5. Write back contacts.json
6. Use `node workspace/skills/business-memory/scripts/contact-lookup.js "name"` for quick search

## How to Update Inventory

1. Read current stock.json
2. Search for matching item (fuzzy — "cement", "Ambuja cement", "cement bags")
3. If found: update quantity (add for inward, subtract for outward)
4. If not found AND user clearly mentions a product: create new item entry
5. Write back stock.json
6. Check if quantity < reorder_point → flag for next briefing

## How to Create Pending Actions

1. Read current actions.json
2. Create new action with next available ID
3. Set appropriate type, target, amount, due_date
4. Write back actions.json

## Answering Queries

### "Kaun kitna deta hai?" / "Yaaru evvalavu kudukkanam?" / "Who owes me?"
Read contacts.json, filter where balance > 0, sort by balance descending.
Format: "Sharma ji: ₹15,000 | Mehta: ₹8,000 | Patel: ₹3,500"

### "Stock kitna hai?" / "Stock eshtu ide?" / "Inventory check"
Read stock.json, list items with quantities.
Flag items below reorder_point with ⚠️

### "Gupta ka last order?" / "Gupta kada last order?" / Contact history
Read contacts.json for Gupta's entry, show notes and balance.
Optionally grep ledger for recent transactions with Gupta.

### "Pending kya hai?" / "Enna pending irukku?" / "What's pending?"
Read actions.json, list pending actions sorted by date.
Highlight overdue items.

## Examples

**User:** "Sharma ne 50 bags cement order diya, delivery kal hoga, total 19000"
**Action:**
1. Find/create Sharma in contacts (type: customer)
2. Set balance += 19000 (they owe us)
3. Create pending action: delivery_expected, due tomorrow
**Response (mirror user's language):** "Got it — Sharma ji, 50 bags cement order, ₹19,000. Delivery tomorrow."

**User:** "Gupta suppliers kitta saamaan vandhudhu, 100 bags cement, 45000 bill"
**Action:**
1. Find/create Gupta in contacts (type: supplier)
2. Set balance -= 45000 (we owe them)
3. Update inventory: cement += 100
**Response (Tamil):** "Noted — Gupta kitta 100 bags vandhudhu, ₹45,000 kudakkanam. Cement stock: 112 bags."

**User:** "Mehta ne 5000 cash diya"
**Action:**
1. Find Mehta in contacts
2. Reduce balance by 5000
3. Log manual cash transaction in ledger
**Response:** "Mehta — ₹5,000 cash received. Pending now ₹10,000."

**User:** "Inniki cement evvalavu poachu?" (Tamil: how much cement sold today?)
**Action:** Grep today's ledger for cement-related entries, sum up.
**Response:** "Inniki 35 bags cement poachu, ₹13,300 total."

**User:** "Sharma ka number kya hai?"
**Action:** Lookup Sharma in contacts.
**Response:** "Sharma ji: +91 98765 43210"

**User:** "Stock lo emi thakkuva undi?" (Telugu: what's low in stock?)
**Action:** Read stock.json, filter quantity < reorder_point.
**Response:** "⚠️ Cement 8 bags maathrame undi (reorder: 10). Migatha antha okay."

**User:** "Patel na 3000 maaf karo" / "Patel 3000 vidunga"
**Action:** Reduce Patel's balance by 3000, add note "₹3000 waived by owner"
**Response:** "Done — Patel ₹3,000 waived. Balance now ₹0."

**User:** "New item add karo — TMT 12mm, 50 pieces, reorder at 10"
**Action:** Add new item to stock.json
**Response:** "Added — TMT 12mm: 50 pcs, reorder at 10."

## Voice-Mentioned Contacts

When the owner mentions a person by name in a voice note, the voice
handler (workspace/lib/voice/voice-handler.js) transcribes it and
passes the text here. Check contacts for the mentioned name:

- Known contact → use existing entry
- Unknown name → create new contact with just the name
  "Someone called Meera placed an order" → new contact "Meera"
  Details fill in over time from future mentions

Voice-specific: Sarvam STT may spell names differently across
languages. Use fuzzy matching on contact names (allow 1-2 character
differences). Examples of variations to handle:
- "Reddy" vs "Reddi"
- "Murugan" vs "Murgan"
- "Patel" vs "Patell"
- English pronunciation vs regional spelling
All should match the same contact.
