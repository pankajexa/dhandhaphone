# Business Monitor Heartbeat

Every 30 minutes, perform these checks:

1. **New SMS**: Run `node workspace/skills/sms-ledger/scripts/sms-poller.js`
   If new transactions found, check if any are >₹5000. If yes, alert
   the owner on Telegram with amount and counterparty.

2. **Overdue Payments**: Read workspace/pending/actions.json.
   Check for any payment_reminder where status=pending and
   due_date is more than 7 days ago. If found and not already
   alerted today, mention in a brief alert.

3. **Battery Check**: Run battery status check. If below 20% and
   not charging, alert the owner: "DhandhaPhone ki battery kam hai,
   charge karo!"

4. **Gateway Health**: Verify the gateway is still connected to
   Telegram. If not, attempt reconnection.

5. **Notification Watch**: Poll Android notifications for UPI app
   payments, POS settlements, and food delivery orders that SMS
   may have missed. Run deduplication against recent ledger entries.

6. **Fraud Detection (Layer 3)**: Run pattern analysis on today's
   transactions. Check for revenue drops, expense spikes, missing
   regular customers, and suspicious counterparty frequency changes.
   Log anomalies to workspace/accounting/fraud-alerts.jsonl.

7. **Credit Aging Check**: Scan contacts with balance > 0. If any
   receivable crossed a new reminder level threshold since last check,
   queue a reminder suggestion for the next owner interaction.

8. **Price Change Monitor**: Check if any newly logged prices deviate
   >5% from last known price for the same item+supplier. If >10%,
   queue an alert for the owner.

9. **GST Filing Reminder**: Check if a GST filing deadline is within
   7 days. If yes, include reminder in next briefing. If within 2
   days, send immediate Telegram alert.

10. **Voice Briefing**: At scheduled briefing times (morning 8 AM,
    evening 8 PM) AND if briefing_voice_enabled is true in
    workspace/lib/voice/voice-config.json:
    1. Generate briefing text (business-briefing skill)
    2. Detect owner's language from recent conversation history
    3. Convert to voice via Sarvam TTS in that language
    4. Send as voice note to Telegram
    5. Also send text version as follow-up message
    Briefing should be under 60 seconds of audio (~150-180 words).

11. **Audio Temp Cleanup**: Clean up /tmp/dhandhaphone-audio/ files
    older than 1 hour. Prevents disk bloat from accumulated voice
    note processing.

IMPORTANT: Most heartbeats should end with HEARTBEAT_OK.
Only message the owner if something genuinely needs attention.
Do NOT send "no new messages" or "everything is fine" updates.
