---
name: gst-assistant
description: >
  Helps with GST rates, tax calculations, filing reminders, and input
  tax credit tracking. Answers queries like "GST kitna lagega", "cement
  pe GST rate kya hai", "GSTR filing kab hai", "input credit kitna hai",
  "invoice mein GST add karo". Knows common Indian GST rates and filing
  deadlines.
metadata:
  openclaw:
    emoji: "🧾"
---

# GST Assistant

## What This Skill Does
Provides GST rate lookups, calculates tax on transactions, tracks input
tax credit (ITC), sends filing deadline reminders, and helps generate
GST-compliant invoice details. Designed for Indian SMBs under regular
or composition scheme.

## Data Locations
- GST profile: `workspace/accounting/gst-profile.json`
- ITC tracker: `workspace/accounting/itc-YYYY-MM.json`
- Filing calendar: embedded in this skill (see below)

## GST Profile
`workspace/accounting/gst-profile.json`:
```json
{
  "gstin": null,
  "scheme": "regular",
  "state_code": "36",
  "filing_frequency": "monthly",
  "last_filed": {
    "gstr1": "2026-01",
    "gstr3b": "2026-01"
  },
  "notes": "Owner to provide GSTIN during setup"
}
```
- `scheme`: "regular" (monthly filing, ITC eligible) or "composition" (quarterly, no ITC)
- If GSTIN is null, remind owner to set it up

## Common GST Rates (India)

### Construction & Hardware (common for SMBs)
| Item | HSN | Rate |
|------|-----|------|
| Cement | 2523 | 28% |
| TMT bars / steel | 7214 | 18% |
| Sand | 2505 | 5% |
| Bricks | 6901 | 5% |
| Paint | 3208 | 28% |
| PVC pipes | 3917 | 18% |
| Electrical wire | 8544 | 18% |
| Tiles (ceramic) | 6907 | 18% |
| Glass | 7005 | 18% |
| Wood/timber | 4407 | 18% |
| Plywood | 4412 | 18% |
| Nails, screws, bolts | 7317/7318 | 18% |

### Food & Restaurant
| Item | HSN | Rate |
|------|-----|------|
| Food grains (unbranded) | 1001-1008 | 0% |
| Branded packaged food | varies | 5-12% |
| Restaurant (non-AC, <₹7500) | 9963 | 5% (no ITC) |
| Restaurant (AC, alcohol) | 9963 | 18% |
| Sweets/namkeen (branded) | 1704/2106 | 5% |
| Beverages (aerated) | 2202 | 28% + cess |

### General Goods
| Item | HSN | Rate |
|------|-----|------|
| Clothing (<₹1000) | 6100-6200 | 5% |
| Clothing (>₹1000) | 6100-6200 | 12% |
| Footwear (<₹1000) | 6401-6405 | 5% |
| Footwear (>₹1000) | 6401-6405 | 18% |
| Electronics | various | 18% |
| Furniture | 9401-9403 | 18% |
| Stationery | 4802-4821 | 12-18% |

### Services
| Service | SAC | Rate |
|---------|-----|------|
| Transport (goods) | 9965 | 5% (no ITC) / 12% |
| Renting commercial | 9972 | 18% |
| IT/software services | 9983 | 18% |
| Maintenance/AMC | 9987 | 18% |

## GST Calculation

### For Regular Scheme
```
Base amount = Total / (1 + GST rate)
GST amount = Total - Base amount

OR if calculating forward:
GST amount = Base × rate
Total = Base + GST amount

For intra-state (same state): Split into CGST + SGST (half each)
For inter-state (different state): Full IGST
```

### For Composition Scheme
```
Quarterly flat rate:
- Manufacturers: 1% of turnover
- Restaurants: 5% of turnover
- Others: 1% of turnover
No ITC available. No tax collection from customers.
```

## Input Tax Credit (ITC) Tracking
`workspace/accounting/itc-YYYY-MM.json`:
```json
{
  "month": "2026-02",
  "input_gst_paid": {
    "inventory-purchase": 33660,
    "rent": 2700,
    "utilities": 1440,
    "transport": 600,
    "maintenance": 360,
    "total": 38760
  },
  "output_gst_collected": {
    "sales": 57600,
    "total": 57600
  },
  "net_liability": 18840,
  "notes": "Net = Output GST - Input GST. Pay this amount."
}
```

Only track ITC for regular scheme. Composition scheme has no ITC.

## Filing Calendar & Reminders

### Monthly Filing (Regular Scheme)
| Return | Due Date | What |
|--------|----------|------|
| GSTR-1 | 11th of next month | Outward supplies (sales) |
| GSTR-3B | 20th of next month | Summary + payment |

### Quarterly Filing (Composition Scheme)
| Return | Due Date | What |
|--------|----------|------|
| CMP-08 | 18th of month after quarter | Payment |
| GSTR-4 | 30th April (annual) | Annual return |

### Reminders
Send reminders via Telegram (in owner's language):
- **7 days before due:** "GSTR-1 filing due in 4 days (11 March). Sales data is ready."
- **2 days before due:** "⚠️ GSTR-3B due tomorrow! Net GST payable: ₹18,840."
- **On due date:** "🚨 Today is the last date for GSTR-3B! Late fee ₹50/day."

## Answering GST Questions

### "Cement pe GST kitna hai?" / "Cement mela GST evvalavu?" / "GST on cement?"
→ "Cement: 28% GST (HSN 2523). On ₹10,000 goods = ₹2,800 GST."

### "Is invoice mein GST batao" / "Invoice la GST sollu"
→ Read invoice amount, identify items, calculate GST per item
→ "₹35,400 invoice: Base ₹30,000 + GST ₹5,400 (28% on cement)"

### "GST file kab karna hai?" / "GST filing deadline?" / "GST eppozhudu file pannanum?"
→ Check filing calendar, show next due dates
→ "GSTR-1: by 11 March | GSTR-3B: by 20 March. Your data is ready."

### "Input credit kitna hai?" / "ITC evvalavu irukku?"
→ Read ITC tracker for current month
→ "This month: ₹38,760 input GST paid. Output ₹57,600. Net payable: ₹18,840."

### "₹50,000 bill hai, GST add karke total?" / "Add GST to ₹50,000 bill"
→ Ask what items (to determine rate), then calculate
→ "₹50,000 + 28% GST = ₹64,000. CGST ₹7,000 + SGST ₹7,000."

## Integration with Other Skills
- **sms-ledger:** Extract GST amounts from bank SMS when possible
- **document-intel:** Extract GST number and amounts from invoice photos
- **accounting:** Feed ITC data into P&L calculations
- **business-briefing:** Include GST filing reminders in morning briefings

## Examples

**User:** "TMT bar ka GST rate?" / "TMT bar GST evvalavu?"
**Response:** "TMT bar: 18% GST (HSN 7214)."

**User:** "₹1 lakh cement order, GST kitna?" / "₹1 lakh cement order, GST how much?"
**Response:** "Cement 28% GST: ₹1,00,000 + ₹28,000 GST = ₹1,28,000 total.
Intra-state: CGST ₹14,000 + SGST ₹14,000."

**User:** "Filing kab hai?" / "Filing deadline when?"
**Response:** "GSTR-1: 11 March (21 days left) | GSTR-3B: 20 March (30 days left). Don't worry, I'll remind you."

**User:** "Composition mein kya farak?" / "What's the difference with composition?"
**Response:** "Composition: flat 1% tax on turnover, quarterly filing, no ITC. Regular: collect 18-28% + get ITC. If turnover < ₹1.5 Cr, composition is cheaper."
