// Parses forwarded messages (WhatsApp, Telegram, email forwards)
// Owner forwards transaction confirmations to the Telegram bot for automatic ledger entry

let parseBankSMS = null;
try {
  ({ parseBankSMS } = require('../../skills/sms-ledger/scripts/sms-parser'));
} catch { /* SMS parser not available — graceful degradation */ }

/**
 * Main entry point: parse a forwarded message into a transaction object.
 * Returns null if the message cannot be parsed as a financial transaction.
 *
 * @param {string} text - Raw forwarded message text
 * @returns {object|null} Parsed transaction or null
 */
function parseForwardedMessage(text) {
  if (!text || typeof text !== 'string') return null;

  // Step 1: Strip forwarding artifacts
  const cleanText = stripForwardingHeaders(text);
  if (!cleanText) return null;

  // Step 2: Try SMS bank parsers first (highest confidence)
  if (parseBankSMS) {
    const smsResult = parseBankSMS({ body: cleanText, address: '', date: null });
    if (smsResult) {
      return {
        type: smsResult.type,
        amount: smsResult.amount,
        counterparty: smsResult.counterparty || null,
        method: smsResult.method || 'OTHER',
        reference_id: smsResult.ref || null,
        source: 'forwarded',
        confidence: 0.75,
      };
    }
  }

  // Step 3: Try UPI notification patterns
  const upiResult = parseUPIText(cleanText);
  if (upiResult) return upiResult;

  // Step 4: Try generic amount extraction (last resort)
  const genericResult = parseGenericAmount(cleanText);
  if (genericResult) return genericResult;

  // Step 5: Can't parse
  return null;
}

/**
 * Remove forwarding artifacts from WhatsApp, Telegram, and email forwards.
 *
 * @param {string} text - Raw message text with possible forwarding headers
 * @returns {string} Cleaned text
 */
function stripForwardingHeaders(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // WhatsApp: "---------- Forwarded message ---------" and variants
    .replace(/^-{2,}\s*Forwarded message\s*-{2,}\s*\n?/im, '')
    // Telegram: "Forwarded from [name]"
    .replace(/^Forwarded from\s+.*\n?/im, '')
    // Email header lines (From, Date, Subject, To)
    .replace(/^From:.*\n?/im, '')
    .replace(/^Date:.*\n?/im, '')
    .replace(/^Subject:.*\n?/im, '')
    .replace(/^To:.*\n?/im, '')
    // [Forwarded] tags
    .replace(/\[Forwarded\]/gi, '')
    .trim();
}

/**
 * Extract UPI transaction details from plain text (e.g., WhatsApp UPI notifications).
 * Looks for ₹amount + direction keywords + counterparty name.
 *
 * @param {string} text - Cleaned message text
 * @returns {object|null} Parsed transaction or null
 */
function parseUPIText(text) {
  // Must contain a rupee amount
  const amountMatch = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (!amount || amount <= 0) return null;

  // Determine credit or debit
  const isCredit = /\b(?:received|credited|got|credit)\b/i.test(text);
  const isDebit = /\b(?:sent|paid|debited|debit|payment)\b/i.test(text);
  if (!isCredit && !isDebit) return null;

  const type = isCredit ? 'credit' : 'debit';

  // Extract counterparty from "from/to NAME" patterns
  let counterparty = null;
  const nameMatch = text.match(/\b(?:from|to)\s+([A-Za-z][A-Za-z\s.]{1,40}?)(?:\s*[.!,]|\s*₹|\s*\(|\s*-|\s*UPI|\s*[Rr]ef|\s*on\b|\s*via\b|$)/i);
  if (nameMatch) {
    counterparty = nameMatch[1]
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 50);
  }

  // Extract UPI reference ID if present
  let reference_id = null;
  const refPatterns = [
    /UPI\s*(?:ref\.?|Ref\.?\s*(?:No\.?)?\s*:?\s*)(\d{6,12})/i,
    /UPI\s*txn\s*(?:ref\.?\s*)?(\d{6,12})/i,
    /UPI[:\s/-]+(\d{6,12})/i,
    /(?:ref(?:erence)?|txn)\s*(?:id|no\.?|#)?\s*:?\s*(\d{6,12})/i,
  ];
  for (const pat of refPatterns) {
    const m = text.match(pat);
    if (m) {
      reference_id = m[1];
      break;
    }
  }

  return {
    type,
    amount,
    counterparty,
    method: 'UPI',
    reference_id,
    source: 'forwarded',
    confidence: 0.70,
  };
}

/**
 * Last-resort parser: find any ₹ amount and credit/debit keywords.
 * Returns with lower confidence (0.55) since extraction is less reliable.
 *
 * @param {string} text - Cleaned message text
 * @returns {object|null} Parsed transaction or null
 */
function parseGenericAmount(text) {
  // Look for any ₹ amount or Rs/INR amount
  const amountPatterns = [
    /₹\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];

  let amount = null;
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }
  if (!amount || amount <= 0) return null;

  // Look for any credit/debit keywords
  const isCredit = /\b(?:received|credited|credit|deposited|got|incoming)\b/i.test(text);
  const isDebit = /\b(?:sent|debited|debit|withdrawn|paid|purchase|outgoing|payment)\b/i.test(text);
  if (!isCredit && !isDebit) return null;

  const type = isCredit ? 'credit' : 'debit';

  // Detect method if mentioned
  let method = 'OTHER';
  if (/\bUPI\b/i.test(text)) method = 'UPI';
  else if (/\bNEFT\b/i.test(text)) method = 'NEFT';
  else if (/\bIMPS\b/i.test(text)) method = 'IMPS';
  else if (/\bRTGS\b/i.test(text)) method = 'RTGS';
  else if (/\bATM\b/i.test(text)) method = 'ATM';
  else if (/\bPOS\b/i.test(text)) method = 'POS';

  return {
    type,
    amount,
    counterparty: null,
    method,
    reference_id: null,
    source: 'forwarded',
    confidence: 0.55,
  };
}

module.exports = { parseForwardedMessage, stripForwardingHeaders };
