# DhandhaPhone E2E Test Checklist

## SMS Pipeline
- [ ] Send fake bank SMS → appears in ledger within 5 minutes
- [ ] Send 3 SMS rapidly → no duplicates in ledger
- [ ] OTP SMS → correctly ignored
- [ ] Promotional SMS → correctly ignored
- [ ] Manual "cash mein 2000 mila" → logged as manual transaction

## Conversation Memory
- [ ] "Sharma ne 50 bags order diya" → Sharma in contacts, stock updated
- [ ] "Gupta ka delivery aaya, 30 bags, 15000" → supplier updated, inventory up
- [ ] "Mehta ne 3 bag return kiya" → inventory adjusted, contact noted
- [ ] "Kitna stock bacha hai?" → accurate answer from stock.json

## Briefings
- [ ] Morning briefing arrives at 7 AM with real data
- [ ] EOD summary arrives at 9 PM with today's actual numbers
- [ ] Weekly report arrives Sunday 8 PM

## Financial Queries
- [ ] "Aaj kitna aaya?" → matches ledger sum
- [ ] "Week ka total?" → matches weekly summary
- [ ] "Sharma ne pay kiya?" → correctly searches ledger
- [ ] "Sabse bada customer kaun hai?" → ranks by balance

## Photo Processing
- [ ] Send invoice photo → key data extracted and logged
- [ ] Send handwritten bill photo → reasonable extraction attempt

## Alerts
- [ ] Large payment (>₹5000) → proactive Telegram alert
- [ ] Battery low (<20%) → warning sent
- [ ] Stock below reorder → mentioned in briefing

## Privacy
- [ ] Grep LLM logs for real names → none found
- [ ] Check .anon-map.json → mappings correct
- [ ] Anonymize/deanonymize round-trip works
