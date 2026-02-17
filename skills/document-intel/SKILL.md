---
name: document-intel
description: >
  Processes photos of invoices, bills, receipts, and handwritten notes
  sent via Telegram. Extracts key data (amounts, dates, party names,
  line items, GST numbers) and updates ledger, contacts, and inventory.
  Also handles voice notes via transcription. Use when user sends a
  photo, image, document, invoice, bill, receipt, or voice message.
metadata:
  openclaw:
    emoji: "📸"
---

# Document Intelligence

## What This Skill Does
Processes photos and voice notes sent by the business owner via
Telegram. Extracts financial and business data from documents and
updates workspace files automatically.

## Supported Document Types
1. **Printed invoices** — supplier bills, purchase orders
2. **Handwritten bills** — kachha bills, manual invoices
3. **Receipts** — payment receipts, cash memos
4. **Price lists** — supplier rate cards
5. **Delivery challans** — goods delivery notes
6. **Bank statements** — monthly statements (photos)
7. **Visiting cards** — contact information extraction

## How to Process a Photo

When the user sends a photo via Telegram, OpenClaw passes it as an
image to you. Follow these steps:

### Step 1: Identify Document Type
Look at the image and determine what kind of document it is.
Common indicators:
- "Invoice" / "Tax Invoice" / "Bill" → Invoice
- Handwritten on plain paper → Kachha bill
- "Receipt" / "Received with thanks" → Payment receipt
- Column of items with prices → Price list or bill

### Step 2: Extract Key Data
For **invoices and bills**, extract:
- Seller/supplier name
- Buyer name (if visible)
- Invoice number and date
- Line items: product name, quantity, rate, amount
- Sub-total, GST/tax, total amount
- Payment terms (if mentioned)
- GST number (if visible)

For **receipts**, extract:
- From whom / to whom
- Amount
- Date
- Purpose/reference

For **visiting cards**, extract:
- Name, designation
- Company name
- Phone number(s)
- Email, address

### Step 3: Update Workspace Files
After extraction:
1. **Contacts:** Add/update the supplier or customer in contacts.json
2. **Inventory:** Update stock levels if it's a delivery/purchase
3. **Ledger:** Add transaction if it's a payment/invoice
4. **Pending:** Create follow-up action if payment is due

### Step 4: Confirm to User
Show extracted data BRIEFLY:
```
Invoice padh liya:
📄 Gupta Suppliers → You
📦 Cement 50 bags × ₹380 = ₹19,000
   TMT 10mm 20 pcs × ₹550 = ₹11,000
💰 Total: ₹30,000 + GST ₹5,400 = ₹35,400
📅 Date: 17 Feb 2026
⏳ Payment due: 15 days

Contacts aur inventory update kar diya.
```

## OCR Fallback
If the built-in vision can't read the document clearly (especially
handwritten regional language text), use the OCR script:
```bash
# eng+hin for Hindi, eng+tam for Tamil, eng+tel for Telugu, etc.
node workspace/skills/document-intel/scripts/ocr.sh <image_path> eng+hin+tam+tel+kan+mal+ben+mar+guj+pan
```

## Voice Note Processing
When the user sends a voice note:
1. OpenClaw's Telegram integration transcribes it automatically
2. Treat the transcription as normal text input
3. Extract business data using the business-memory skill logic
4. Confirm what was understood

If transcription is unclear, ask: "Yeh samajh nahi aaya, dobara bol
sakte hain? Ya type kar dijiye."

## Language Handling
- Indian invoices may be in any regional language, English, or bilingual
- GST invoices are usually English
- Kachha bills may be in Hindi, Tamil, Telugu, Kannada, or any local language
- Handle ALL Indian languages gracefully — extract what you can

## Examples

**User sends photo of a cement invoice**
**Response:** "Invoice dekh liya — Raj Cement se 100 bags @ ₹385 = ₹38,500.
GST: ₹6,930. Total: ₹45,430. Payment 15 din mein. Stock updated."

**User sends photo of a handwritten bill**
**Response:** "Kachha bill padh liya — Patel Hardware:
- Nut bolt: 500 pcs, ₹2,500
- Washer: 200 pcs, ₹600
Total: ₹3,100. Cash bill hai, no GST."

**User sends a visiting card**
**Response:** "Contact save kiya — Ramesh Agarwal, Sales Manager,
Ambuja Cement. Phone: 98765 43210."

**User sends voice note: "Aaj Sharma se 20 bags cement ka order aaya,
delivery parson hoga, total 7600 rupay"**
**Response:** "Got it — Sharma ji ka 20 bags cement order, ₹7,600.
Delivery parson. Pending mein add kar diya."

## Error Handling (respond in owner's language)
- If image is blurry: "Photo is not clear, some details are hard to read.
  Please type the important numbers."
- If partial extraction: Show what was extracted, ask for missing info
- Never make up numbers — if amount isn't clear, ask
