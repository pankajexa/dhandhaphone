# DhandhaPhone — Project Context

> **Read this file FIRST before touching any code. It contains everything you need to understand the project, its architecture, dependencies, platform constraints, and design decisions.**

---

## 1. What Is DhandhaPhone?

DhandhaPhone is an AI-powered business assistant for Indian small business owners (SMBs). It runs on a **spare Android phone** that sits plugged in on the shop counter, always on, always listening for bank SMS, and always available via Telegram.

**The owner interacts via Telegram on their primary phone.** The AI phone is infrastructure — like a WiFi router or CCTV DVR — not something they touch directly.

**Core value proposition:** "Your ₹3,000 spare phone becomes a 24/7 business manager that tracks every rupee, reminds customers to pay, and gives you a morning briefing — all in Hindi-English."

### What It Does
1. **Passively reads bank/UPI SMS** on the AI phone's SIM → auto-logs every transaction
2. **Remembers everything the owner tells it** via Telegram chat → builds customer, supplier, inventory records
3. **Proactively sends briefings** every morning and evening → daily revenue, pending payments, stock alerts
4. **Answers questions** → "How much did Sharma owe?", "Total sales this week?", "What did Gupta quote for TMT?"
5. **Processes photos** → invoice OCR, bill extraction, handwritten note parsing
6. **Drafts messages** → payment reminders, order confirmations (owner approves before sending)

### What It Is NOT
- Not a POS system (BountiPOS is the separate product for that)
- Not a WhatsApp bot (we explicitly rejected WhatsApp due to Meta ban risk)
- Not a cloud service (data lives on the phone, only anonymized queries go to LLM)
- Not business-type-specific (works for ANY business — hardware store, restaurant, kirana, garment shop)

---

## 2. Technology Stack

### Runtime Environment: OpenClaw on Android

**OpenClaw** (https://github.com/openclaw/openclaw) is an MIT-licensed open-source AI agent framework. It runs a local "Gateway" that connects LLMs to messaging platforms and tools via "skills."

On Android, it runs via:
```
Android Phone
  └── Termux (terminal emulator, from F-Droid)
      └── proot-distro (Ubuntu 24.04, user-space, no root needed)
          └── Node.js 22
              └── OpenClaw Gateway (npm package)
                  ├── Telegram channel (grammY library)
                  ├── Skills (SKILL.md files — our custom business logic)
                  ├── Cron jobs (scheduled tasks — briefings, SMS polling)
                  ├── Heartbeat (periodic checks — stock alerts, anomaly detection)
                  └── Memory (Markdown files in workspace/)
```

**Key constraint:** The `os.networkInterfaces()` call crashes on Android's Bionic libc. A "Bionic Bypass" script patches this:
```javascript
// ~/.openclaw/bionic-bypass.js — MUST be loaded via NODE_OPTIONS
const os = require('os');
const orig = os.networkInterfaces;
os.networkInterfaces = function() {
  try { const r = orig.call(os); if (r && Object.keys(r).length > 0) return r; } catch {}
  return { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4',
    mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
};
```

**Environment variable required:**
```bash
export NODE_OPTIONS="--require ~/.openclaw/bionic-bypass.js"
```

### Android Hardware Access: Termux:API

Termux:API (F-Droid package `com.termux.api`) exposes Android hardware to shell commands. These commands are callable from Node.js via `child_process.exec()` inside the proot Ubuntu environment.

**Commands we use:**

| Command | What It Does | Permission Required |
|---|---|---|
| `termux-sms-list -l N -t inbox` | Read last N SMS from inbox (JSON output) | SMS permission |
| `termux-sms-list -l N -t inbox -n` | Read last N SMS, newer first | SMS permission |
| `termux-notification-list` | List all current Android notifications (JSON) | Notification Listener |
| `termux-call-log -l N` | Read last N call log entries (JSON) | Phone permission |
| `termux-sms-send -n NUMBER "text"` | Send SMS | SMS permission |
| `termux-tts-speak "text"` | Text-to-speech | None |
| `termux-vibrate` | Vibrate device | None |
| `termux-battery-status` | Battery level, charging state (JSON) | None |
| `termux-wifi-connectioninfo` | WiFi connection details (JSON) | Location permission |

**SMS output format (termux-sms-list):**
```json
[
  {
    "threadid": 1,
    "address": "HDFCBK",
    "body": "Rs.5000.00 credited to a/c XX1234 on 17-02-26 by UPI ref 423567890. Avl bal: Rs.47200.00",
    "date": "2026-02-17 10:30:00",
    "read": true,
    "type": "inbox",
    "_id": 1547
  }
]
```

**Notification output format (termux-notification-list):**
```json
[
  {
    "id": 12345,
    "tag": "",
    "key": "0|com.google.android.apps.nbu.paisa|12345|null|10234",
    "group": "",
    "packageName": "com.google.android.apps.nbu.paisa",
    "title": "Payment received",
    "content": "₹5,000 received from Rajesh Kumar",
    "when": "2026-02-17 10:30:00"
  }
]
```

**IMPORTANT:** Termux:API commands run in Termux's environment, NOT inside proot Ubuntu. From inside proot, you must call them via the host's binary path. The standard approach is:
```bash
# From inside proot Ubuntu, access Termux commands via:
/host-rootfs/data/data/com.termux/files/usr/bin/termux-sms-list -l 50 -t inbox
# OR set up a wrapper script during setup
```

Alternatively, the OpenClaw community approach is to use a shell script bridge or Node.js `child_process` that shells out to the Termux binary.

### Messaging: Telegram Bot API

OpenClaw connects to Telegram via the **grammY** library (official Bot API wrapper). Configuration is in `~/.openclaw/openclaw.json` under `channels.telegram`.

**Telegram Bot setup:**
1. Message @BotFather on Telegram → `/newbot` → get bot token
2. Configure in OpenClaw onboarding or directly in `openclaw.json`

**What Telegram supports that we use:**
- Text messages (bidirectional)
- Voice notes (Telegram transcribes or OpenClaw's STT processes)
- Photos (forwarded invoices, bills)
- Inline keyboards (approve/reject buttons for actions)
- Markdown formatting in messages

**What the owner sees:** A normal Telegram chat with their business bot. They type or voice-note naturally.

### LLM: Model-Agnostic via OpenClaw

OpenClaw supports multiple LLM providers. During onboarding, you select one. Configuration in `openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-2.0-flash"
      }
    }
  }
}
```

**For MVP/pilot, use Gemini Flash** — free tier from Google AI Studio (60 req/min, ~1000/day). This is sufficient for a single-user pilot. Production will use our own LLM routing backend.

### Data Storage: Local Files

OpenClaw stores everything as files in the workspace directory:

```
~/.openclaw/
├── openclaw.json          # Main configuration
├── bionic-bypass.js       # Android compatibility patch
├── cron/
│   └── jobs.json          # Scheduled jobs
├── whatsapp-sessions/     # (unused — we use Telegram)
└── workspace/             # All business data lives here
    ├── memory/            # OpenClaw's built-in memory (Markdown)
    ├── HEARTBEAT.md       # Heartbeat task checklist
    ├── SOUL.md            # Agent personality/rules
    ├── AGENTS.md          # Agent configuration
    ├── skills/            # Custom business skills
    │   ├── sms-ledger/
    │   │   ├── SKILL.md
    │   │   └── scripts/
    │   ├── business-memory/
    │   │   └── SKILL.md
    │   ├── business-briefing/
    │   │   └── SKILL.md
    │   └── document-intel/
    │       └── SKILL.md
    ├── ledger/            # Transaction logs
    │   ├── 2026-02.jsonl  # One file per month, append-only
    │   └── summary.json   # Running totals
    ├── contacts/
    │   └── contacts.json  # People directory
    ├── inventory/
    │   └── stock.json     # Current stock levels
    ├── pending/
    │   └── actions.json   # Reminders, follow-ups
    ├── sms/
    │   └── last_processed_id.txt  # Deduplication marker
    └── .anon-map.json     # PII anonymization mappings (never sent to cloud)
```

---

## 3. OpenClaw Skill System

Skills are the core extension mechanism. Each skill is a **directory** containing a `SKILL.md` file with YAML frontmatter + Markdown instructions.

### SKILL.md Format

```markdown
---
name: skill-name
description: >
  One-paragraph description. This is used by OpenClaw to decide
  WHEN to activate this skill. Write it like describing the task
  to a coworker. Include trigger keywords users would say.
metadata:
  openclaw:
    emoji: "💰"
    requires:
      bins: ["some-binary"]  # optional: required CLI tools
---

# Skill Title

## What This Skill Does
Explain behavior in plain English.

## Instructions
Step-by-step guide for the LLM on how to use this skill.
Include file paths, data schemas, example inputs/outputs.

## Examples
Show sample user inputs and expected agent behavior.
```

### How Skills Load
1. OpenClaw scans skill directories on startup and session refresh
2. Eligible skills (based on tool availability) are injected into the system prompt as XML
3. The LLM reads skill instructions and follows them when relevant
4. Skills can reference workspace files, run bash commands, call tools

### Skill Directories (Precedence)
1. `<workspace>/skills/` (highest — per-agent)
2. `~/.openclaw/skills/` (managed — user-defined, shared across agents)
3. Bundled skills (lowest — shipped with OpenClaw npm package)

### Key Skill Capabilities
- Read/write files in workspace
- Execute bash commands (including Termux:API)
- Access OpenClaw memory
- Send messages via configured channels (Telegram)
- Use sub-agents for complex tasks

---

## 4. OpenClaw Cron & Heartbeat System

### Cron Jobs
Persistent scheduler built into the Gateway. Jobs survive restarts.

```bash
# Add a cron job via CLI
openclaw cron add --json '{
  "name": "job-name",
  "schedule": {"kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Kolkata"},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Natural language instruction for the agent.",
    "deliver": true,
    "channel": "telegram",
    "bestEffortDeliver": true
  }
}'
```

**Session types:**
- `"main"` — runs in main conversation context (needs heartbeat enabled)
- `"isolated"` — runs in fresh session, no conversation history pollution

**Payload types:**
- `"agentTurn"` (isolated) — full agent turn with natural language prompt
- `"systemEvent"` (main) — injects event into main session's heartbeat

### Heartbeat
Periodic check-in (default every 30 minutes). The agent reads `HEARTBEAT.md` in workspace, checks for pending tasks, and either sends HEARTBEAT_OK (silent) or takes action.

**HEARTBEAT.md** is a markdown file listing what the agent should check on each heartbeat cycle.

---

## 5. Indian Bank SMS Patterns

These are the actual SMS formats from major Indian banks that the SMS parser must handle. Patterns vary significantly across banks.

### Credit (Money Received)

**HDFC Bank:**
```
Rs.5000.00 credited to a/c XX1234 on 17-02-26 by UPI ref 423567890. Avl bal: Rs.47200.00
INR 5,000.00 credited to HDFC Bank A/c XX1234 on 17-02-2026 by a]transfer from RAJESH KUMAR. Avl bal: INR 47,200.00
```

**SBI:**
```
Dear Customer, your a/c no. XX1234 is credited by Rs.5,000.00 on 17Feb26 transfer from SHARMA (UPI Ref No 423567890). -SBI
Your a/c XX1234 credited INR 5000.00 on 17-Feb-26 Info: UPI/423567890/SHARMA
```

**ICICI:**
```
ICICI Bank Acct XX1234 credited with Rs 5,000.00 on 17-Feb-26; UPI: 423567890 from SHARMA. Avl Bal Rs 47,200.00
```

**Axis Bank:**
```
Rs 5,000.00 credited to A/c no. XX1234 on 17-02-2026 through UPI-423567890. Bal: Rs 47,200.00
```

**Kotak:**
```
Rs 5000.00 is credited in your Kotak Bank A/c XX1234 on 17/02/2026 by NEFT from SHARMA. Updated Bal:Rs 47200.00
```

### Debit (Money Sent)

**HDFC:**
```
Rs.12000.00 debited from a/c XX1234 on 17-02-26. UPI txn Ref 987654321. Avl bal: Rs.35200.00
```

**SBI:**
```
Dear Customer, your a/c no. XX1234 is debited for Rs.12,000.00 on 17Feb26 trf to GUPTA SUPPLIERS (UPI Ref No 987654321). -SBI
```

### UPI App Notifications (via Notification Listener)

**Google Pay (packageName: com.google.android.apps.nbu.paisa):**
```
title: "Payment received"
content: "₹5,000 received from Rajesh Kumar"

title: "Payment sent"
content: "₹12,000 sent to Gupta Suppliers"
```

**PhonePe (packageName: com.phonepe.app):**
```
title: "Received ₹5,000"
content: "From Rajesh Kumar to your bank account"

title: "Paid ₹12,000"
content: "To Gupta Suppliers from your bank account"
```

**Paytm (packageName: net.one97.paytm):**
```
title: "₹5,000 received"
content: "Payment from Rajesh Kumar"
```

### Critical Gotchas
- **SBI does NOT send credit SMS for all UPI handles.** Only @sbi and @oksbi triggers credit SMS. Payments via @paytm, @ybl etc. often go silent. MUST supplement with Notification Listener.
- **HDFC stopped SMS for UPI under ₹100 (debit) and ₹500 (credit)** as of mid-2024. Small transactions won't appear in SMS.
- **Bank SMS sender addresses vary:** "HDFCBK", "SBI", "ICICIB", "AxisBk", "KOTAKB" etc. These are NOT phone numbers — they're alphanumeric sender IDs.
- **Amount formats vary:** "Rs.5000.00", "Rs 5,000.00", "INR 5000.00", "₹5,000", "Rs.5,000/-"
- **Date formats vary:** "17-02-26", "17-02-2026", "17Feb26", "17/02/2026", "17-Feb-26"

---

## 6. Privacy Architecture

### Principle: Extract locally, reason remotely, never leak PII.

**Layer 1 — On-device extraction (no cloud):**
- SMS regex parsing → structured transaction data
- Conversation extraction → contacts, inventory, pending actions
- All stored as local JSON/JSONL files

**Layer 2 — Anonymization before LLM calls:**
- Real names → token IDs (e.g., "Sharma ji" → "C-007")
- Phone numbers → stripped entirely
- Bank account numbers → stripped
- UPI IDs → stripped
- Amounts, dates, product names, quantities → KEPT (safe)

**Layer 3 — De-anonymization after LLM response:**
- Token IDs → real names before displaying to user
- Mapping stored in `.anon-map.json` on device only

### What the LLM sees (example):
```
Customer C-007 has outstanding balance of ₹15,000 for 30 units of
building material, invoice dated Feb 10, 7 days overdue. Draft a
polite Hindi-English payment reminder for a retail business.
```

### What the LLM NEVER sees:
```
Sharma ji from Begumpet owes ₹15,000 for cement, phone 9876543210,
account HDFC XX1234
```

---

## 7. Language & Tone

Indian business owners code-switch between Hindi and English constantly. The assistant MUST do the same.

**Example morning briefing (correct tone):**
```
Suprabhat! 🌅
Kal ka hisaab: ₹47,200 aaya (23 orders), ₹12,000 gaya (Gupta payment).
⚠️ Sharma ji ka ₹15,000 ab 5 din se pending hai — yaad dilayein?
📦 Cement sirf 12 bags bacha — aaj ka average 8-10 hai, order dena chahiye.
Aaj ka din achha ho! 💪
```

**NOT this (too formal, too English):**
```
Good morning. Yesterday's revenue was ₹47,200 across 23 transactions.
Expenses totaled ₹12,000. Customer Sharma has an outstanding balance
of ₹15,000 that is 5 days overdue. Consider sending a reminder.
```

The LLM should be instructed (via SOUL.md) to match the user's language. If they type in Hindi, respond in Hindi. If Hinglish, respond in Hinglish. If pure English, respond in English.

---

## 8. File Schemas

### Transaction (ledger/YYYY-MM.jsonl)
One JSON object per line, append-only:
```json
{"id":"txn_20260217_001","ts":"2026-02-17T10:30:00+05:30","type":"credit","amount":5000,"counterparty":"SHARMA","method":"UPI","ref":"423567890","bank":"HDFC","acct_last4":"1234","raw":"Rs.5000.00 credited to a/c XX1234...","source":"sms","category":null,"notes":null}
```

### Contact (contacts/contacts.json)
```json
{
  "contacts": [
    {
      "id": "C-001",
      "name": "Sharma ji",
      "type": "customer",
      "phone": "+919876543210",
      "balance": 15000,
      "last_interaction": "2026-02-17",
      "notes": "Hardware store owner, Begumpet. Usually orders cement and TMT bars."
    },
    {
      "id": "S-001",
      "name": "Gupta Suppliers",
      "type": "supplier",
      "phone": "+919876543211",
      "balance": -35000,
      "last_interaction": "2026-02-17",
      "notes": "Main cement and TMT supplier. 15 day credit terms."
    }
  ]
}
```

**Balance convention:** Positive = they owe us. Negative = we owe them.

### Inventory (inventory/stock.json)
```json
{
  "items": [
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
  ]
}
```

### Pending Actions (pending/actions.json)
```json
{
  "actions": [
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
  ]
}
```

### Summary (ledger/summary.json)
```json
{
  "today": {"credits": 32400, "debits": 8200, "count": 15},
  "this_week": {"credits": 147200, "debits": 53000, "count": 72},
  "this_month": {"credits": 523000, "debits": 187000, "count": 312},
  "last_updated": "2026-02-17T16:30:00+05:30"
}
```

### Anonymization Map (.anon-map.json)
```json
{
  "people": {"Sharma ji": "C-001", "Gupta Suppliers": "S-001"},
  "phones": {"+919876543210": "PHONE-001"},
  "accounts": {"XX1234": "ACCT-001"}
}
```

---

## 9. Target Hardware

**Minimum:** Any Android 10+ phone with 3GB RAM, 32GB storage. Examples:
- Redmi Note 9 Pro (2020) — ₹3,000-4,000 used
- Moto G (various years) — ₹2,000-3,000 used
- Realme C-series — ₹5,000 new

**Battery:** Phone stays plugged in 24/7. Battery acts as UPS during power cuts.

**SIM:** Any cheap 4G plan. Jio ₹149/month for data + SMS reception.

**Connectivity:** WiFi preferred but 4G data works fine. LLM calls are small text payloads.

---

## 10. What "Done" Looks Like

When the MVP is complete, this sequence works end-to-end:

1. ✅ OpenClaw Gateway running on Android phone via Termux+proot
2. ✅ Telegram bot connected and responding
3. ✅ Bank SMS automatically parsed into transaction ledger
4. ✅ Owner chats naturally → contacts/inventory/actions updated
5. ✅ 7 AM morning briefing delivered via Telegram
6. ✅ 9 PM end-of-day summary delivered via Telegram
7. ✅ Owner asks "kitna aaya aaj?" → gets accurate revenue from ledger
8. ✅ Owner says "Sharma ko payment yaad dilao" → gets draft reminder to approve
9. ✅ Owner forwards invoice photo → data extracted and logged
10. ✅ All PII stripped before any LLM call; de-anonymized after response
