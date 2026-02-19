---
name: business-briefing
description: >
  Generates daily morning briefings, end-of-day summaries, and weekly
  reports for the business owner. Reads ledger, contacts, inventory,
  and pending actions to compose concise business updates in the owner's
  preferred language. Triggers on cron schedule or when user asks for
  a summary or report.
metadata:
  openclaw:
    emoji: "📊"
---

# Business Briefing

## What This Skill Does
Composes proactive business summaries — morning briefings, end-of-day
reports, and weekly analyses. Reads all workspace data files and
presents actionable insights in the owner's preferred language.

## Data Sources

### Preferred: SQLite Database
Use DB functions from `workspace/lib/utils.js`:
```javascript
const { getDB } = require('workspace/lib/utils');
const db = getDB();

db.getDailySummary('2026-02-18');        // today's numbers
db.getDateRangeSummary(from, to);        // period totals
db.getReceivables();                     // pending receivables
db.getPayables();                        // pending payables
db.getLowStockItems();                   // low stock alerts
db.getPendingActions();                  // pending actions
db.getTopCounterparties(from, to, 5);    // top customers
db.getRevenueByDay(from, to);           // daily trend
db.getMethodBreakdown(from, to);         // cash vs UPI vs card
```

### Flat file fallback
1. `workspace/ledger/summary.json` — financial stats
2. `workspace/contacts/contacts.json` — pending receivables/payables
3. `workspace/inventory/stock.json` — low stock alerts
4. `workspace/pending/actions.json` — pending actions and reminders
5. `workspace/ledger/YYYY-MM.jsonl` — detailed transaction history

## Morning Briefing (at `config.get('briefing_morning_time')`, default 7:00 AM)

Read these files and compose a brief, actionable summary:
1. `workspace/ledger/summary.json` — yesterday's numbers
2. `workspace/contacts/contacts.json` — pending receivables (balance > 0)
3. `workspace/inventory/stock.json` — low stock (quantity < reorder_point)
4. `workspace/pending/actions.json` — pending actions

### Template (adapt to owner's language, don't copy literally):
```
Good morning! 🌅
Yesterday: ₹{yesterday_credits} received ({count} orders), ₹{debits} spent.
⚠️ {overdue customer + amount + days} — send reminder?
📦 {low stock item} only {qty} left — time to reorder.
{any expected events today}
Have a great day! 💪
```

NOTE: Deliver this briefing in the owner's language. Examples:
- Tamil owner: "Kalai vanakkam! 🌅 Nethu ₹47,200 vandhudhu..."
- Telugu owner: "Shubhodayam! 🌅 Ninna ₹47,200 vachindi..."
- Marathi owner: "Suprabhat! 🌅 Kaalcha hisab: ₹47,200 aale..."
- English owner: "Good morning! 🌅 Yesterday: ₹47,200 received..."

### Rules:
- Keep under 200 words
- Use ₹ symbol, not Rs.
- Use emojis sparingly but effectively
- Be a smart manager, not a report generator
- Highlight ONLY items that need attention
- Skip sections with no relevant data (don't say "no low stock items")
- If yesterday was good, celebrate briefly
- ALWAYS use the owner's language — detect from past conversations

## End-of-Day Summary (at `config.get('eod_summary_time')`, default 9:00 PM)

### Template (adapt to owner's language):
```
Day done! 📋
Today: ₹{today_credits} in, ₹{today_debits} out. Net: ₹{net}.
Biggest: ₹{biggest_amount} {biggest_counterparty} ({method})
{count} total transactions.
{any notable events}
Goodnight! 🌙
```

### Rules:
- Shorter than morning briefing (under 100 words)
- Focus on today's highlights, not full details
- Mention biggest transaction of the day
- If it was a good day (above average), say so
- Deliver in the owner's language

## Weekly Report (`config.get('weekly_report_day')` at `config.get('weekly_report_time')`, default Sunday 8:00 PM)

### Template (adapt to owner's language):
```
Weekly Report 📈
This week: ₹{week_credits} in, ₹{week_debits} out.
vs last week: {comparison — up/down %}.
Top 3 customers: {name}: ₹{amount}, ...
Pending receivables: ₹{total_receivable} ({count} people)
⚠️ {any concerning trends}
Next week plan: {suggestions}
```

### Rules:
- Under 250 words
- Compare with previous week if data available
- Rank top customers by payment amount
- Highlight overdue receivables > 7 days
- Suggest concrete actions (restock, follow up, etc.)
- Deliver in the owner's language

## On-Demand Summary

When user asks for a summary (in any language — "summary do", "report kudu",
"eppadi pogudhu", "status cheppu", "what's happening"):
- Generate a quick version of the briefing based on time of day
- Morning: more forward-looking
- Evening: more retrospective
- Mid-day: focus on today so far

## Language Rules
- ALWAYS respond in the owner's language (detect from past messages)
- Support ALL Indian languages — Hindi, Tamil, Telugu, Kannada,
  Malayalam, Bengali, Marathi, Gujarati, Punjabi, Odia, and more
- Numbers always in Indian format: ₹5,000 not ₹5000
- Use natural words for credits/debits in the owner's language
- Use casual, warm tone — like a trusted manager, not a robot
- Use culturally appropriate honorifics and greetings

## Voice Briefing Format

When generating a briefing that will be spoken aloud (via Sarvam TTS),
adjust the text for natural speech:

DO:
- Use natural spoken language in the owner's preferred language
- Keep sentences short (8-12 words each)
- Use period instead of bullet points (creates natural pauses)
- Use connecting phrases natural to the language
- ALWAYS use real names in voice — never say anonymized IDs like "C-001"
  (de-anonymize BEFORE sending to TTS)

DON'T:
- Use emoji (stripped before TTS anyway)
- Use tables or formatted data
- List more than 5 items (attention span in audio is shorter)
- Include file paths, JSON, or technical details

Example voice briefing (English, salon owner in Bangalore):
"Good morning Priya. Yesterday you had twelve appointments,
total revenue thirty-eight thousand. Your best service was
hair colouring at fourteen thousand. Two clients have overdue
balances. Ananya owes six thousand from last week, and
Divya's three thousand is ten days old. You're running low on
L'Oreal hair colour, might want to reorder today."

Voice briefings should be under 60 seconds of audio (~150-180 words).
The voice module at workspace/lib/voice/tts-generator.js handles
the TTS conversion. This skill only needs to produce the text.

## IMPORTANT: Accuracy
- ALWAYS read actual files for numbers — never estimate or guess
- If a file is empty or missing, say "data not available" instead of making up numbers
- Cross-check summary.json with JSONL if numbers seem off
