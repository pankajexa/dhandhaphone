#!/bin/bash
# DhandhaPhone Setup Script
# Run inside proot Ubuntu on Android
# Prerequisites: Termux + Termux:API + proot-distro Ubuntu + Node.js 22

set -e

echo "DhandhaPhone Setup Starting..."

WORKSPACE="$HOME/.openclaw/workspace"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Create directory structure
echo "Creating workspace..."
mkdir -p "$WORKSPACE"/{skills/{sms-ledger/scripts,business-memory/scripts,business-briefing/scripts,document-intel/scripts,notification-watch/scripts,accounting/scripts,gst-assistant/scripts,fraud-detect/scripts,credit-manager/scripts,price-memory/scripts},ledger,contacts,inventory,pending,sms,ocr,lib,lib/voice,lib/sarvam,lib/documents,accounting}

# 2. Copy skill files
echo "Installing skills..."
cp "$REPO_DIR/skills/sms-ledger/SKILL.md" "$WORKSPACE/skills/sms-ledger/"
cp "$REPO_DIR/skills/sms-ledger/scripts/"*.js "$WORKSPACE/skills/sms-ledger/scripts/"
cp "$REPO_DIR/skills/business-memory/SKILL.md" "$WORKSPACE/skills/business-memory/"
cp "$REPO_DIR/skills/business-memory/scripts/"*.js "$WORKSPACE/skills/business-memory/scripts/"
cp "$REPO_DIR/skills/business-briefing/SKILL.md" "$WORKSPACE/skills/business-briefing/"
cp "$REPO_DIR/skills/document-intel/SKILL.md" "$WORKSPACE/skills/document-intel/"
cp "$REPO_DIR/skills/document-intel/scripts/"*.sh "$WORKSPACE/skills/document-intel/scripts/"
for skill in notification-watch accounting gst-assistant fraud-detect credit-manager price-memory; do
  cp "$REPO_DIR/skills/$skill/SKILL.md" "$WORKSPACE/skills/$skill/"
done

# 3. Copy shared library
echo "Installing shared libraries..."
cp "$REPO_DIR/lib/"*.js "$WORKSPACE/lib/"
cp "$REPO_DIR/lib/"*.sh "$WORKSPACE/lib/" 2>/dev/null || true
cp -r "$REPO_DIR/lib/voice/" "$WORKSPACE/lib/voice/"
cp -r "$REPO_DIR/lib/sarvam/" "$WORKSPACE/lib/sarvam/"
cp -r "$REPO_DIR/lib/documents/" "$WORKSPACE/lib/documents/"

# 4. Create symlinks from skills to shared lib
echo "Linking shared scripts..."
cd "$WORKSPACE/skills"
for skill in sms-ledger business-memory business-briefing document-intel; do
  ln -sf ../../lib/termux-api.js "$skill/scripts/termux-api.js" 2>/dev/null || true
  ln -sf ../../lib/termux-bridge.sh "$skill/scripts/termux-bridge.sh" 2>/dev/null || true
  ln -sf ../../lib/utils.js "$skill/scripts/utils.js" 2>/dev/null || true
done

# 5. Copy config files
echo "Installing agent configuration..."
cp "$REPO_DIR/config/AGENTS.md" "$WORKSPACE/"
cp "$REPO_DIR/config/SOUL.md" "$WORKSPACE/"
cp "$REPO_DIR/config/HEARTBEAT.md" "$WORKSPACE/"

# 6. Initialize data files (only if they don't exist)
echo "Initializing data..."
[ -f "$WORKSPACE/contacts/contacts.json" ] || echo '{"contacts":[],"next_customer_id":1,"next_supplier_id":1,"next_staff_id":1}' > "$WORKSPACE/contacts/contacts.json"
[ -f "$WORKSPACE/inventory/stock.json" ] || echo '{"items":[],"last_updated":""}' > "$WORKSPACE/inventory/stock.json"
[ -f "$WORKSPACE/pending/actions.json" ] || echo '{"actions":[],"next_id":1}' > "$WORKSPACE/pending/actions.json"
[ -f "$WORKSPACE/ledger/summary.json" ] || echo '{"today":{"credits":0,"debits":0,"count":0,"date":""},"this_week":{"credits":0,"debits":0,"count":0,"week_start":""},"this_month":{"credits":0,"debits":0,"count":0,"month":""},"last_updated":""}' > "$WORKSPACE/ledger/summary.json"
[ -f "$WORKSPACE/sms/last_processed_id.txt" ] || echo '0' > "$WORKSPACE/sms/last_processed_id.txt"
[ -f "$WORKSPACE/.anon-map.json" ] || echo '{"people":{},"phones":{},"accounts":{},"reverse_people":{}}' > "$WORKSPACE/.anon-map.json"

# 7. Make scripts executable
chmod +x "$WORKSPACE"/skills/*/scripts/*.sh 2>/dev/null || true
chmod +x "$WORKSPACE"/lib/*.sh 2>/dev/null || true

# 8. Set up bionic bypass
echo "Configuring Bionic Bypass..."
cat > "$HOME/.openclaw/bionic-bypass.js" << 'EOF'
const os = require('os');
const orig = os.networkInterfaces;
os.networkInterfaces = function() {
  try { const r = orig.call(os); if (r && Object.keys(r).length > 0) return r; } catch {}
  return { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
};
EOF

# Add NODE_OPTIONS to bashrc if not already present
if ! grep -q "bionic-bypass" "$HOME/.bashrc" 2>/dev/null; then
  echo 'export NODE_OPTIONS="--require $HOME/.openclaw/bionic-bypass.js"' >> "$HOME/.bashrc"
fi

# 9. Set up watchdog
echo "Installing watchdog..."
cat > "$HOME/.openclaw/watchdog.sh" << 'WATCHDOG'
#!/bin/bash
while true; do
  if ! pgrep -f "openclaw gateway" > /dev/null; then
    echo "[$(date)] Restarting gateway..." >> "$HOME/.openclaw/watchdog.log"
    export NODE_OPTIONS="--require $HOME/.openclaw/bionic-bypass.js"
    nohup openclaw gateway --verbose >> "$HOME/.openclaw/gateway.log" 2>&1 &
  fi
  sleep 60
done
WATCHDOG
chmod +x "$HOME/.openclaw/watchdog.sh"

# Add watchdog to bashrc if not already present
if ! grep -q "watchdog.sh" "$HOME/.bashrc" 2>/dev/null; then
  echo 'nohup bash ~/.openclaw/watchdog.sh > /dev/null 2>&1 &' >> "$HOME/.bashrc"
fi

# 10. Set up API keys (.env)
echo "Setting up API keys..."
if [ ! -f "$REPO_DIR/.env" ]; then
  if [ -f "$REPO_DIR/.env.example" ]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
    echo "⚠️  Created .env from template. You MUST edit it with your keys."
  fi
fi
# Symlink .env into workspace so lib/env.js can find it
ln -sf "$REPO_DIR/.env" "$WORKSPACE/../.env" 2>/dev/null || true

echo ""
echo "DhandhaPhone installed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Add your API keys to .env"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Edit: $REPO_DIR/.env"
echo ""
echo "  Required keys:"
echo "  ANTHROPIC_API_KEY  — Get at https://console.anthropic.com/settings/keys"
echo "  SARVAM_API_KEY     — Get at https://dashboard.sarvam.ai (free ₹1,000)"
echo "  TELEGRAM_BOT_TOKEN — Get from @BotFather on Telegram"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Run OpenClaw onboarding"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  openclaw onboard"
echo "   -> Select Telegram as channel"
echo "   -> Select Anthropic as model provider"
echo "   -> Select Loopback (127.0.0.1) for binding"
echo ""
echo "2. Start the gateway: openclaw gateway --verbose"
echo ""
echo "3. Register cron jobs (run these after gateway is up):"
echo ""
echo '   # SMS polling every 5 minutes'
echo '   openclaw cron add --json '"'"'{'
echo '     "name": "sms-poll",'
echo '     "schedule": {"kind": "cron", "expr": "*/5 * * * *", "tz": "Asia/Kolkata"},'
echo '     "sessionTarget": "isolated",'
echo '     "payload": {'
echo '       "kind": "agentTurn",'
echo '       "message": "Run the SMS poller to check for new bank transactions. Execute: node workspace/skills/sms-ledger/scripts/sms-poller.js. If any large transactions (>5000) were found, send a brief alert to the owner via Telegram.",'
echo '       "deliver": false'
echo '     }'
echo '   }'"'"''
echo ""
echo '   # Morning briefing at 7 AM'
echo '   openclaw cron add --json '"'"'{'
echo '     "name": "morning-briefing",'
echo '     "schedule": {"kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Kolkata"},'
echo '     "sessionTarget": "isolated",'
echo '     "payload": {'
echo '       "kind": "agentTurn",'
echo '       "message": "Generate morning business briefing. Read workspace/ledger/summary.json, contacts, inventory, and pending actions. Send briefing in the owner language via Telegram.",'
echo '       "deliver": true,'
echo '       "channel": "telegram",'
echo '       "bestEffortDeliver": true'
echo '     }'
echo '   }'"'"''
echo ""
echo '   # EOD summary at 9 PM'
echo '   openclaw cron add --json '"'"'{'
echo '     "name": "eod-summary",'
echo '     "schedule": {"kind": "cron", "expr": "0 21 * * *", "tz": "Asia/Kolkata"},'
echo '     "sessionTarget": "isolated",'
echo '     "payload": {'
echo '       "kind": "agentTurn",'
echo '       "message": "Generate end-of-day business summary. Read today stats and send via Telegram.",'
echo '       "deliver": true,'
echo '       "channel": "telegram",'
echo '       "bestEffortDeliver": true'
echo '     }'
echo '   }'"'"''
echo ""
echo '   # Weekly report on Sunday 8 PM'
echo '   openclaw cron add --json '"'"'{'
echo '     "name": "weekly-report",'
echo '     "schedule": {"kind": "cron", "expr": "0 20 * * 0", "tz": "Asia/Kolkata"},'
echo '     "sessionTarget": "isolated",'
echo '     "payload": {'
echo '       "kind": "agentTurn",'
echo '       "message": "Generate weekly business report. Compare with last week. Send via Telegram.",'
echo '       "deliver": true,'
echo '       "channel": "telegram",'
echo '       "bestEffortDeliver": true'
echo '     }'
echo '   }'"'"''
echo ""
echo "4. Message your Telegram bot to test!"
echo ""
