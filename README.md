# DhandhaPhone

AI-powered business assistant for Indian small business owners (SMBs). Runs on a spare Android phone, automatically tracks bank transactions via SMS, manages contacts and inventory, and delivers daily business briefings — all through Telegram.

**Core value:** Your spare phone becomes a 24/7 business manager that tracks every rupee, reminds customers to pay, and gives you a morning briefing — in your language.

## Architecture

```
Owner's Primary Phone (Telegram)
        |
        v
   Telegram Bot API
        |
        v
Spare Android Phone (AI Phone)
  └── Termux (F-Droid)
      └── proot-distro (Ubuntu 24.04)
          └── Node.js 22
              └── OpenClaw Gateway
                  ├── Telegram Channel (grammY)
                  ├── Skills
                  │   ├── sms-ledger      (auto-parse bank SMS)
                  │   ├── business-memory  (contacts, inventory, actions)
                  │   ├── business-briefing (morning/EOD/weekly reports)
                  │   └── document-intel   (invoice OCR, photo processing)
                  ├── Cron Jobs (SMS poll, briefings)
                  ├── Heartbeat (stock alerts, battery check)
                  └── Local Data (JSONL ledger, JSON configs)
```

## Prerequisites

- Android 10+ phone with 3GB+ RAM
- [Termux](https://f-droid.org/en/packages/com.termux/) (from F-Droid, NOT Play Store)
- [Termux:API](https://f-droid.org/en/packages/com.termux.api/) (from F-Droid)
- Node.js 22 (installed inside proot Ubuntu)
- [OpenClaw](https://github.com/openclaw/openclaw) (`npm install -g openclaw`)
- A Telegram bot token (from @BotFather)
- A Gemini API key (free tier from Google AI Studio)

## Quick Start

```bash
# 1. Inside Termux, install proot Ubuntu
pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu

# 2. Inside Ubuntu, install Node.js and OpenClaw
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g openclaw

# 3. Clone and run setup
git clone <your-repo-url> /tmp/dhandhaphone
bash /tmp/dhandhaphone/setup-dhandhaphone.sh

# 4. Onboard OpenClaw (select Telegram + Gemini)
openclaw onboard

# 5. Start the gateway
openclaw gateway --verbose
```

Then message your Telegram bot to test!

## Project Structure

```
dhandhaphone/
├── README.md
├── context.md              # Full project context and architecture
├── build_plan.md           # Detailed build plan
├── setup-dhandhaphone.sh   # One-command installer
├── skills/
│   ├── sms-ledger/         # Auto-parse bank SMS into transactions
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       ├── sms-parser.js
│   │       ├── sms-poller.js
│   │       ├── ledger-query.js
│   │       ├── rebuild-summary.js
│   │       └── test-parser.js
│   ├── business-memory/    # Contacts, inventory, pending actions
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── contact-lookup.js
│   ├── business-briefing/  # Morning, EOD, weekly reports
│   │   └── SKILL.md
│   └── document-intel/     # Invoice OCR, photo processing
│       ├── SKILL.md
│       └── scripts/
│           └── ocr.sh
├── lib/                    # Shared utilities
│   ├── utils.js
│   ├── termux-api.js
│   ├── termux-bridge.sh
│   ├── anonymize.js
│   └── repair.js
├── config/                 # Agent personality and rules
│   ├── AGENTS.md
│   ├── SOUL.md
│   └── HEARTBEAT.md
├── server/                 # Cloud LLM router (runs on your server)
│   ├── main.py
│   ├── requirements.txt
│   └── run.sh
├── tests/
│   ├── test-parser.js
│   └── e2e-checklist.md
└── data/                   # Created at runtime
    ├── ledger/
    ├── contacts/
    ├── inventory/
    ├── pending/
    └── sms/
```

## Key Features

| Feature | How It Works |
|---|---|
| Auto SMS tracking | Reads bank SMS every 5 min, parses transactions into JSONL ledger |
| UPI notification capture | Catches Google Pay/PhonePe/Paytm notifications for SMS gaps |
| Business memory | Silently extracts contacts, stock, orders from natural conversation |
| Morning briefing (7 AM) | Yesterday's revenue, pending payments, low stock alerts |
| EOD summary (9 PM) | Today's numbers, biggest transactions |
| Weekly report (Sun 8 PM) | Week comparison, top customers, trends |
| Invoice OCR | Photo → extracted line items, amounts, parties |
| Payment reminders | Drafts reminders for overdue payments in the customer's language |
| PII anonymization | Names/phones stripped before any cloud LLM call |

## Privacy

All data stays on the phone. Before any LLM API call:
- Customer/supplier names are replaced with anonymous IDs (C-001, S-001)
- Phone numbers are stripped
- Bank account numbers are stripped
- Only amounts, dates, and product names are sent to the cloud

## Cloud LLM Router (Optional)

For production use beyond Gemini free tier, deploy the FastAPI router:

```bash
cd server
export GEMINI_API_KEY="your-key"
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Routes requests to Gemini Flash (cheap), DeepSeek V3 (medium), or Claude Sonnet (complex) based on task complexity.

## License

MIT
