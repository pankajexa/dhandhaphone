// Parses Indian bank SMS into structured transactions
// Handles: SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, and generic patterns

/**
 * Parse a bank SMS into a transaction object.
 * Returns null if SMS is not a financial transaction.
 */
function parseBankSMS(sms) {
  const body = sms.body || '';
  const sender = (sms.address || '').toUpperCase();

  // Skip OTP, promotional, non-financial SMS
  if (/OTP|otp|One Time Password|verification code/i.test(body)) return null;
  if (/offer|cashback|reward|EMI|loan|insurance|credit card/i.test(body)
      && !/credited|debited/i.test(body)) return null;

  let txn = {
    id: null, // set by caller
    ts: parseTimestamp(sms.date),
    type: null,     // 'credit' or 'debit'
    amount: null,
    counterparty: null,
    method: null,    // 'UPI', 'NEFT', 'IMPS', 'ATM', 'POS', 'CASH', 'OTHER'
    ref: null,
    bank: identifyBank(sender),
    acct_last4: null,
    raw: body,
    source: 'sms',
    sms_id: sms._id,
    category: null,
    notes: null
  };

  // --- AMOUNT EXTRACTION ---
  // Patterns: "Rs.5000.00", "Rs 5,000.00", "INR 5000.00", "₹5,000", "Rs.5,000/-"
  const amountPatterns = [
    /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:amount|amt)\s*(?:of\s*)?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{2}))\s*(?:has been|is)\s*(?:credited|debited)/i,
  ];

  for (const pat of amountPatterns) {
    const m = body.match(pat);
    if (m) {
      txn.amount = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }
  if (!txn.amount || txn.amount <= 0) return null;

  // --- CREDIT / DEBIT DETECTION ---
  if (/credited|received|credit(?:ed)?|deposited/i.test(body)) {
    txn.type = 'credit';
  } else if (/debited|sent|debit(?:ed)?|withdrawn|paid|purchase/i.test(body)) {
    txn.type = 'debit';
  } else {
    return null; // Can't determine direction
  }

  // --- ACCOUNT NUMBER ---
  const acctMatch = body.match(/(?:a\/c|acct?|account)\s*(?:no\.?\s*)?[X*x]*(\d{4})/i);
  if (acctMatch) txn.acct_last4 = acctMatch[1];

  // --- UPI REFERENCE ---
  const upiPatterns = [
    /UPI\s*(?:ref\.?|Ref\.?\s*(?:No\.?)?\s*:?\s*)(\d{6,12})/i,
    /UPI\s*txn\s*(?:ref\.?\s*)?(\d{6,12})/i,
    /UPI[:\s-]+(\d{6,12})/i,
    /UPI\/(\d{6,12})/i,
  ];
  for (const pat of upiPatterns) {
    const m = body.match(pat);
    if (m) {
      txn.ref = m[1];
      txn.method = 'UPI';
      break;
    }
  }

  // --- NEFT / IMPS / RTGS ---
  if (/NEFT/i.test(body)) txn.method = 'NEFT';
  else if (/IMPS/i.test(body)) txn.method = 'IMPS';
  else if (/RTGS/i.test(body)) txn.method = 'RTGS';
  else if (/ATM/i.test(body)) txn.method = 'ATM';
  else if (/POS|purchase|merchant/i.test(body)) txn.method = 'POS';
  if (!txn.method) txn.method = 'OTHER';

  // --- COUNTERPARTY ---
  const cpPatterns = [
    /(?:from|to|trf\s+(?:from|to)|transfer\s+(?:from|to))\s+([A-Z][A-Z\s]{2,30}?)(?:\s*\(|\s*\.|\s*-|\s*UPI|\s*Ref|\s*Avl|\s+via\b|$)/i,
    /(?:by|via)\s+([A-Z][A-Z\s]{2,30}?)(?:\s*\(|\s*\.|\s*-|\s*UPI|\s*Ref|$)/i,
    /VPA\s+(\S+@\S+)/i, // UPI VPA
  ];

  for (const pat of cpPatterns) {
    const m = body.match(pat);
    if (m) {
      txn.counterparty = m[1].trim()
        .replace(/\s+/g, ' ')       // normalize spaces
        .replace(/[()]/g, '')        // remove parens
        .substring(0, 50);           // cap length
      break;
    }
  }

  return txn;
}

function parseTimestamp(dateStr) {
  if (!dateStr) return new Date().toISOString();
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}
  return new Date().toISOString();
}

function identifyBank(sender) {
  const s = sender.toUpperCase();
  if (/HDFC|HDFCBK/i.test(s)) return 'HDFC';
  if (/SBI|SBIINB|SBISMS/i.test(s)) return 'SBI';
  if (/ICICI|ICICIB/i.test(s)) return 'ICICI';
  if (/AXIS|AXISBK/i.test(s)) return 'AXIS';
  if (/KOTAK|KOTAKB/i.test(s)) return 'KOTAK';
  if (/PNB|PNBSMS/i.test(s)) return 'PNB';
  if (/BOB|BOBIBN/i.test(s)) return 'BOB';
  if (/CANARA|CANBK/i.test(s)) return 'CANARA';
  if (/UNION|UNBISMS/i.test(s)) return 'UNION';
  if (/INDUS|IBKL/i.test(s)) return 'INDUSIND';
  if (/FEDER|FEDBK/i.test(s)) return 'FEDERAL';
  return 'UNKNOWN';
}

/**
 * Parse UPI app notifications (from termux-notification-list)
 */
function parseUPINotification(notif) {
  const pkg = notif.packageName || '';
  const title = notif.title || '';
  const content = notif.content || '';
  const combined = `${title} ${content}`;

  // Google Pay
  if (pkg.includes('nbu.paisa') || pkg.includes('tez')) {
    return parseGenericPaymentNotif(combined, 'GPAY');
  }
  // PhonePe
  if (pkg.includes('phonepe')) {
    return parseGenericPaymentNotif(combined, 'PHONEPE');
  }
  // Paytm
  if (pkg.includes('paytm') || pkg.includes('one97')) {
    return parseGenericPaymentNotif(combined, 'PAYTM');
  }

  return null;
}

function parseGenericPaymentNotif(text, app) {
  const amountMatch = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (amount <= 0) return null;

  const isCredit = /received|credited|got|incoming/i.test(text);
  const isDebit = /sent|paid|debited|outgoing/i.test(text);
  if (!isCredit && !isDebit) return null;

  // Extract name
  let counterparty = null;
  const nameMatch = text.match(/(?:from|to)\s+([A-Za-z][A-Za-z\s]{2,30})/i);
  if (nameMatch) counterparty = nameMatch[1].trim();

  return {
    type: isCredit ? 'credit' : 'debit',
    amount,
    counterparty,
    method: 'UPI',
    source: `notification-${app.toLowerCase()}`,
  };
}

module.exports = { parseBankSMS, parseUPINotification };
