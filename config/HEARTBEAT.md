# Business Monitor Heartbeat

All thresholds below are configurable via `workspace/lib/config.js`.
Read them with `config.get('key_name')`. The owner can change any
threshold by asking in Telegram (see SOUL.md "Configuration Changes").

Every `config.get('heartbeat_interval_min')` minutes (default 30), perform these checks:

1. **Notification Poller**: Run the notification listener:
    ```bash
    node workspace/gateway/ingestion/notification-poller.js
    ```
    Captures UPI payments, POS transactions, platform orders (Swiggy/Zomato/Amazon/Flipkart),
    and banking app alerts from 13 monitored apps. Output is JSON — if any `immediate` items
    exist (food delivery orders), alert the owner instantly. If `needsConfirmation` items exist,
    ask owner to verify.

2. **New SMS**: Run `node workspace/skills/sms-ledger/scripts/sms-poller.js`
   If new transactions found, check if any exceed
   `config.get('alert_large_transaction')` (default ₹5,000). If yes, alert
   the owner on Telegram with amount and counterparty.

3. **Overdue Payments**: Read workspace/pending/actions.json.
   Check for any payment_reminder where status=pending and
   due_date is more than `config.get('alert_overdue_days')` (default 7)
   days ago. If found and not already alerted today, mention in a brief alert.

4. **Battery Check**: Run battery status check. If below
   `config.get('battery_alert_threshold')` (default 20%) and not
   charging, alert the owner: "DhandhaPhone ki battery kam hai,
   charge karo!"

5. **Gateway Health**: Verify the gateway is still connected to
   Telegram. If not, attempt reconnection.

6. **Notification Watch**: Poll Android notifications for UPI app
   payments, POS settlements, and food delivery orders that SMS
   may have missed. Run deduplication against recent ledger entries.

7. **Fraud Detection (Layer 3)**: Pattern analysis is now handled by
   the brain's anomaly detector (item 15 below). This heartbeat item
   is retained for any additional manual fraud checks the agent may
   want to perform outside the brain pipeline.

8. **Credit Aging Check**: Scan contacts with balance > 0. If any
   receivable crossed a new reminder level threshold since last check,
   queue a reminder suggestion for the next owner interaction.

9. **Price Change Monitor**: Check if any newly logged prices deviate
   more than `config.get('price_change_alert_pct')` (default 5%) from
   last known price for the same item+supplier. If more than
   `config.get('price_change_immediate_pct')` (default 10%),
   queue an immediate alert for the owner.

10. **GST Filing Reminder**: Check if a GST filing deadline is within
    `config.get('gst_reminder_advance_days')` (default 7) days. If yes,
    include reminder in next briefing. If within
    `config.get('gst_reminder_urgent_days')` (default 2) days, send
    immediate Telegram alert.

11. **Voice Briefing**: At scheduled briefing times —
    `config.get('briefing_morning_time')` (default 7:00 AM) and
    `config.get('briefing_evening_time')` (default 8:00 PM) — AND if
    `config.get('voice_briefing_enabled')` is true:
    1. Generate briefing text (business-briefing skill)
    2. Detect owner's language from `config.get('owner_language')` or
       recent conversation history
    3. Convert to voice via Sarvam TTS in that language
    4. Send as voice note to Telegram
    5. Also send text version as follow-up message
    Briefing should be under 60 seconds of audio (~150-180 words).

12. **Audio Temp Cleanup**: Clean up /tmp/dhandhaphone-audio/ files
    older than 1 hour. Prevents disk bloat from accumulated voice
    note processing.

13. **Database Backup**: At `config.get('db_backup_time')` (default
    11 PM) daily, back up the SQLite database.
    ```bash
    node -e "
      const { getDB } = require('workspace/lib/utils');
      const config = require('workspace/lib/config');
      const path = require('path');
      const fs = require('fs');
      const db = getDB();
      const today = new Date().toISOString().split('T')[0];
      const backupDir = path.join(process.env.DHANDHA_WORKSPACE || process.env.HOME + '/.openclaw/workspace', 'backups');
      db.backup(path.join(backupDir, 'dhandhaphone-' + today + '.db'));
      const retention = config.get('db_backup_retention');
      const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort().reverse();
      for (const old of backups.slice(retention)) fs.unlinkSync(path.join(backupDir, old));
    "
    ```

14. **Onboarding Reminder**: If `config.isOnboardingStarted()` is true
    but `config.isOnboarded()` is false, and more than 24 hours have
    passed since `config.get('onboarding_started_at')`, send a gentle
    reminder ONCE (check `config.get('onboarding_reminder_sent')`):
    "Hi! We didn't finish setting up DhandhaPhone. Just need a few
    more details — reply when you're ready!"
    After sending: `config.set('onboarding_reminder_sent', true)`

NOTE: For summary queries (daily totals, method breakdown, top customers,
overdue receivables), prefer using the SQLite database via `getDB()` from
`workspace/lib/utils.js`. DB queries are faster than reading flat files.
Key functions: `db.getDailySummary(date)`, `db.getDateRangeSummary(from, to)`,
`db.getReceivables()`, `db.getLowStockItems()`, `db.getPendingAlerts()`.

15. **Brain Maintenance**: Run the brain maintenance script:
    ```bash
    node workspace/lib/brain/heartbeat-brain.js
    ```
    Handles: anomaly detection, pattern refresh, edge decay, observation sweep,
    festival/deadline checks, business snapshot update. Output is JSON — if
    any alerts[] are present, notify the owner in their language.

16. **Channel Health Check**: Run daily (once per day, at noon):
    ```bash
    node -e "const {getDB}=require('./lib/utils'); const {ChannelHealth}=require('./gateway/ingestion/channel-health'); const ch=new ChannelHealth(getDB()); console.log(JSON.stringify(ch.checkHealth()))"
    ```
    Monitors SMS/notification freshness, dedup ratios. Alert owner if any channel
    goes silent for too long.

IMPORTANT: Most heartbeats should end with HEARTBEAT_OK.
Only message the owner if something genuinely needs attention.
Do NOT send "no new messages" or "everything is fine" updates.
