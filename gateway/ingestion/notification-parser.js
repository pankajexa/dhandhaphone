'use strict';

function extractAmount(text) {
  const match = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

function extractUPIRef(text) {
  const match = text.match(/(?:UPI\s*Ref|Ref\.?\s*(?:No|ID)?|Txn\s*(?:ID|No))[:\s]*(\d{10,})/i);
  return match ? match[1] : null;
}

function extractOrderId(text) {
  const match = text.match(/#\s*([A-Z0-9-]{4,})/i);
  return match ? match[1] : null;
}

function baseResult(overrides) {
  return Object.assign({
    amount: null,
    type: null,
    counterparty: null,
    method: 'UPI',
    reference_id: null,
    confidence: 0,
    category: null,
    orderId: null,
    items: null,
    isSettlement: false
  }, overrides);
}

function parseGPay(title, content) {
  title = title || '';
  content = content || '';
  const contentMatch = content.match(
    /₹\s*([\d,]+(?:\.\d{1,2})?)\s*(?:sent to|paid to|received from)\s*(.+?)(?:\.|$|\s*via|\s*UPI)/i
  );
  if (contentMatch) {
    const amount = parseFloat(contentMatch[1].replace(/,/g, ''));
    const counterparty = contentMatch[2].trim();
    const type = /sent|paid/i.test(content) ? 'debit' : 'credit';
    return baseResult({
      amount,
      type,
      counterparty,
      reference_id: extractUPIRef(content),
      confidence: 0.92
    });
  }

  const paymentMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*received from\s*(.+?)(?:\.|$)/i);
  if (paymentMatch) {
    return baseResult({
      amount: parseFloat(paymentMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: paymentMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.92
    });
  }

  const youPaidMatch = content.match(/You paid\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*to\s*(.+?)(?:\.|$|\s*UPI)/i);
  if (youPaidMatch) {
    return baseResult({
      amount: parseFloat(youPaidMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: youPaidMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.92
    });
  }

  const titleAmount = title.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (titleAmount) {
    return baseResult({
      amount: parseFloat(titleAmount[1].replace(/,/g, '')),
      type: /sent|paid|payment to/i.test(title) ? 'debit' : 'credit',
      confidence: 0.75
    });
  }

  return null;
}

function parsePhonePe(title, content) {
  const combined = title + ' ' + content;

  if (/cashback/i.test(combined)) {
    const amt = extractAmount(combined);
    if (!amt) return null;
    return baseResult({
      amount: amt,
      type: 'credit',
      method: 'WALLET',
      counterparty: 'PhonePe Cashback',
      confidence: 0.90,
      category: 'cashback'
    });
  }

  if (/wallet.*transfer|transfer.*wallet|wallet.*bank/i.test(combined)) {
    return null;
  }

  if (/autopay/i.test(combined)) {
    const amt = extractAmount(combined);
    if (!amt) return null;
    const toMatch = combined.match(/(?:to|for)\s+(.+?)(?:\s+successful|\.|$|\s*Ref)/i);
    return baseResult({
      amount: amt,
      type: 'debit',
      counterparty: toMatch ? toMatch[1].trim() : null,
      reference_id: extractUPIRef(combined),
      confidence: 0.90,
      category: 'recurring'
    });
  }

  const sentMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*sent to\s*(.+?)(?:\s*successfully|$|\.\s*Ref)/i);
  if (sentMatch) {
    return baseResult({
      amount: parseFloat(sentMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: sentMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const recvMatch = content.match(/Received\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*from\s*(.+?)(?:\.|$|\s*Ref)/i);
  if (recvMatch) {
    return baseResult({
      amount: parseFloat(recvMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: recvMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const paymentMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*to\s*(.+?)(?:\s*successful|$)/i);
  if (paymentMatch) {
    return baseResult({
      amount: parseFloat(paymentMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: paymentMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  if (/Sent\s*₹/i.test(title)) {
    const amt = extractAmount(title);
    if (amt) return baseResult({ amount: amt, type: 'debit', confidence: 0.75 });
  }
  if (/Received\s*₹|Money Received/i.test(title)) {
    const amt = extractAmount(combined);
    if (amt) return baseResult({ amount: amt, type: 'credit', confidence: 0.75 });
  }

  return null;
}

function parsePaytm(title, content) {
  const combined = title + ' ' + content;

  if (/added to Paytm Wallet/i.test(combined)) {
    return null;
  }

  if (/cashback/i.test(combined)) {
    const amt = extractAmount(combined);
    if (!amt) return null;
    return baseResult({
      amount: amt,
      type: 'credit',
      method: 'WALLET',
      counterparty: 'Paytm Cashback',
      confidence: 0.88,
      category: 'cashback'
    });
  }

  const paidMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*paid to\s*(.+?)(?:\.|$|\s*Order)/i);
  if (paidMatch) {
    const orderMatch = content.match(/Order\s*ID[:\s]*([A-Z0-9-]+)/i);
    const method = /from Wallet/i.test(content) ? 'WALLET' : 'UPI';
    return baseResult({
      amount: parseFloat(paidMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: paidMatch[2].trim(),
      method,
      reference_id: orderMatch ? orderMatch[1] : extractUPIRef(content),
      confidence: 0.88
    });
  }

  const recvMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*received from\s*(.+?)(?:\.|$)/i);
  if (recvMatch) {
    return baseResult({
      amount: parseFloat(recvMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: recvMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.88
    });
  }

  const bizMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*received\.\s*Total today[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (bizMatch) {
    return baseResult({
      amount: parseFloat(bizMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: null,
      confidence: 0.88
    });
  }

  const paymentForMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*for\s*(.+?)(?:\s*successful|$)/i);
  if (paymentForMatch) {
    return baseResult({
      amount: parseFloat(paymentForMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: paymentForMatch[2].trim(),
      method: /from Wallet/i.test(content) ? 'WALLET' : 'UPI',
      confidence: 0.88
    });
  }

  if (/Money Received/i.test(title)) {
    const amt = extractAmount(combined);
    if (amt) return baseResult({ amount: amt, type: 'credit', confidence: 0.70 });
  }

  return null;
}

function parseBHIM(title, content) {
  const paidMatch = content.match(/Paid\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*to\s*([^\s.]+@[^\s.]+)/i);
  if (paidMatch) {
    return baseResult({
      amount: parseFloat(paidMatch[1].replace(/,/g, '')),
      type: 'debit',
      counterparty: paidMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const recvMatch = content.match(/Received\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*from\s*([^\s.]+@[^\s.]+)/i);
  if (recvMatch) {
    return baseResult({
      amount: parseFloat(recvMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: recvMatch[2].trim(),
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const debitedMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*debited from\s*A\/c\s*(\d{4})/i);
  if (debitedMatch) {
    return baseResult({
      amount: parseFloat(debitedMatch[1].replace(/,/g, '')),
      type: 'debit',
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const creditedMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*credited to\s*A\/c\s*(\d{4})/i);
  if (creditedMatch) {
    return baseResult({
      amount: parseFloat(creditedMatch[1].replace(/,/g, '')),
      type: 'credit',
      reference_id: extractUPIRef(content),
      confidence: 0.90
    });
  }

  const amt = extractAmount(content);
  if (amt && /Transaction Successful|Money Received/i.test(title)) {
    const type = /Received|credited/i.test(title + ' ' + content) ? 'credit' : 'debit';
    return baseResult({ amount: amt, type, reference_id: extractUPIRef(content), confidence: 0.75 });
  }

  return null;
}

function parsePineLabs(title, content) {
  if (/settlement/i.test(content)) {
    const amt = extractAmount(content);
    if (amt) {
      return baseResult({
        amount: amt,
        type: 'credit',
        method: 'BANK',
        counterparty: 'Pine Labs Settlement',
        confidence: 0.88,
        isSettlement: true
      });
    }
    return null;
  }

  const approvedMatch = content.match(/Transaction approved\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*on\s*(\S+)/i);
  if (approvedMatch) {
    return baseResult({
      amount: parseFloat(approvedMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'CARD',
      counterparty: null,
      reference_id: approvedMatch[2].trim(),
      confidence: 0.88
    });
  }

  const saleMatch = content.match(/Sale of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*[-–]\s*Card ending\s*(\d{4})/i);
  if (saleMatch) {
    return baseResult({
      amount: parseFloat(saleMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'CARD',
      counterparty: 'Card **' + saleMatch[2],
      confidence: 0.88
    });
  }

  return null;
}

function parseRazorpay(title, content) {
  if (/settlement/i.test(content)) {
    const amt = extractAmount(content);
    if (amt) {
      return baseResult({
        amount: amt,
        type: 'credit',
        method: 'BANK',
        counterparty: 'Razorpay Settlement',
        confidence: 0.88,
        isSettlement: true
      });
    }
    return null;
  }

  if (/Razorpay fee/i.test(content)) {
    const amt = extractAmount(content);
    if (amt) {
      return baseResult({
        amount: amt,
        type: 'debit',
        method: 'PLATFORM',
        counterparty: 'Razorpay Fee',
        confidence: 0.88,
        category: 'platform_fee'
      });
    }
    return null;
  }

  const recvMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*received via\s*(\w+)/i);
  if (recvMatch) {
    const methodMap = { upi: 'UPI', card: 'CARD', netbanking: 'BANK', wallet: 'WALLET' };
    const rawMethod = recvMatch[2].toLowerCase();
    const refMatch = content.match(/Payment\s*ID[:\s]*(\S+)/i);
    return baseResult({
      amount: parseFloat(recvMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: methodMap[rawMethod] || 'UPI',
      reference_id: refMatch ? refMatch[1] : null,
      confidence: 0.88
    });
  }

  const paymentMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*from\s*(.+?)(?:\s*successful|$)/i);
  if (paymentMatch) {
    return baseResult({
      amount: parseFloat(paymentMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: paymentMatch[2].trim(),
      confidence: 0.88
    });
  }

  return null;
}

function parsePetpooja(title, content) {
  if (/KOT/i.test(content) && !/₹/.test(content)) {
    return null;
  }

  const completedMatch = content.match(/Order\s*#\s*([A-Z0-9-]+)\s*completed\s*[-–]\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (completedMatch) {
    return baseResult({
      amount: parseFloat(completedMatch[2].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      orderId: completedMatch[1],
      confidence: 0.85
    });
  }

  const billMatch = content.match(/Table\s*(\d+)\s*[-–]\s*Bill\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (billMatch) {
    return baseResult({
      amount: parseFloat(billMatch[2].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Table ' + billMatch[1],
      confidence: 0.85
    });
  }

  const newOrderMatch = content.match(/New Order\s*#\s*([A-Z0-9-]+)\s*[-–]\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (newOrderMatch) {
    return baseResult({
      amount: parseFloat(newOrderMatch[2].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      orderId: newOrderMatch[1],
      confidence: 0.70,
      category: 'platform_pending'
    });
  }

  return null;
}

function parseInstamojo(title, content) {
  if (/payout/i.test(content)) {
    const amt = extractAmount(content);
    if (amt) {
      return baseResult({
        amount: amt,
        type: 'credit',
        method: 'BANK',
        counterparty: 'Instamojo Payout',
        confidence: 0.88,
        isSettlement: true
      });
    }
    return null;
  }

  const linkMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*payment link paid by\s*(.+?)(?:\.|$)/i);
  if (linkMatch) {
    return baseResult({
      amount: parseFloat(linkMatch[1].replace(/,/g, '')),
      type: 'credit',
      counterparty: linkMatch[2].trim(),
      confidence: 0.88
    });
  }

  const recvMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*received/i);
  if (recvMatch) {
    return baseResult({
      amount: parseFloat(recvMatch[1].replace(/,/g, '')),
      type: 'credit',
      confidence: 0.88
    });
  }

  return null;
}

function parseSwiggy(title, content) {
  const newOrderMatch = content.match(/New order!\s*#\s*([A-Z0-9-]+)\s*[-–]\s*(.+?)\s*[-–]\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (newOrderMatch) {
    return baseResult({
      amount: parseFloat(newOrderMatch[3].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Swiggy',
      orderId: newOrderMatch[1],
      items: newOrderMatch[2].trim(),
      confidence: 0.90,
      category: 'platform_pending'
    });
  }

  const payoutMatch = content.match(/(?:Weekly|Daily)\s*payout[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (payoutMatch) {
    return baseResult({
      amount: parseFloat(payoutMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: 'Swiggy Payout',
      confidence: 0.90,
      isSettlement: true
    });
  }

  const summaryMatch = content.match(/Daily summary[:\s]*(\d+)\s*orders?,\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (summaryMatch) {
    return baseResult({
      amount: parseFloat(summaryMatch[2].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Swiggy Daily Summary',
      confidence: 0.85,
      category: 'daily_summary'
    });
  }

  if (/picked up|delivered/i.test(content)) {
    return null;
  }

  return null;
}

function parseZomato(title, content) {
  const orderAmountMatch = content.match(/Order\s*#\s*([A-Z0-9-]+)[:\s]*(.+?)\s*[-–]\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (orderAmountMatch) {
    return baseResult({
      amount: parseFloat(orderAmountMatch[3].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Zomato',
      orderId: orderAmountMatch[1],
      items: orderAmountMatch[2].trim(),
      confidence: 0.90,
      category: 'platform_pending'
    });
  }

  const newOrderMatch = content.match(/New order\s*#\s*([A-Z0-9-]+)\s*from\s*(.+?)(?:\.|$)/i);
  if (newOrderMatch) {
    const amt = extractAmount(content);
    return baseResult({
      amount: amt,
      type: 'credit',
      method: 'PLATFORM',
      counterparty: newOrderMatch[2].trim(),
      orderId: newOrderMatch[1],
      confidence: amt ? 0.90 : 0.70,
      category: 'platform_pending'
    });
  }

  const payoutMatch = content.match(/Payout processed[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (payoutMatch) {
    return baseResult({
      amount: parseFloat(payoutMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: 'Zomato Payout',
      confidence: 0.90,
      isSettlement: true
    });
  }

  const earningsMatch = content.match(/Daily earnings[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)\s*from\s*(\d+)\s*orders?/i);
  if (earningsMatch) {
    return baseResult({
      amount: parseFloat(earningsMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Zomato Daily Summary',
      confidence: 0.85,
      category: 'daily_summary'
    });
  }

  return null;
}

function parseAmazon(title, content) {
  const combined = title + ' ' + content;

  if (/return requested/i.test(combined)) {
    const orderId = extractOrderId(combined);
    const amt = extractAmount(combined);
    return baseResult({
      amount: amt,
      type: 'debit',
      method: 'PLATFORM',
      counterparty: 'Amazon Return',
      orderId,
      confidence: amt ? 0.85 : 0.60,
      category: 'return'
    });
  }

  const depositMatch = content.match(/Payment of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*deposited/i);
  if (depositMatch) {
    return baseResult({
      amount: parseFloat(depositMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: 'Amazon Settlement',
      confidence: 0.85,
      isSettlement: true
    });
  }

  const newOrderMatch = content.match(/New order[:\s]*(.+?)\s*[-–]\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (newOrderMatch) {
    return baseResult({
      amount: parseFloat(newOrderMatch[2].replace(/,/g, '')),
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Amazon',
      items: newOrderMatch[1].trim(),
      orderId: extractOrderId(combined),
      confidence: 0.85,
      category: 'platform_pending'
    });
  }

  if (/shipped/i.test(combined)) {
    return null;
  }

  return null;
}

function parseFlipkart(title, content) {
  const combined = title + ' ' + content;

  if (/return initiated/i.test(combined)) {
    const orderId = extractOrderId(combined);
    const amt = extractAmount(combined);
    return baseResult({
      amount: amt,
      type: 'debit',
      method: 'PLATFORM',
      counterparty: 'Flipkart Return',
      orderId,
      confidence: amt ? 0.85 : 0.60,
      category: 'return'
    });
  }

  const settlementMatch = content.match(/Settlement of\s*₹\s*([\d,]+(?:\.\d{1,2})?)\s*completed/i);
  if (settlementMatch) {
    return baseResult({
      amount: parseFloat(settlementMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: 'Flipkart Settlement',
      confidence: 0.85,
      isSettlement: true
    });
  }

  const paymentMatch = content.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*payment processed/i);
  if (paymentMatch) {
    return baseResult({
      amount: parseFloat(paymentMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: 'Flipkart',
      confidence: 0.85,
      isSettlement: true
    });
  }

  const newOrderMatch = content.match(/New order for\s+(.+?)(?:\.|$)/i);
  if (newOrderMatch) {
    const amt = extractAmount(combined);
    return baseResult({
      amount: amt,
      type: 'credit',
      method: 'PLATFORM',
      counterparty: 'Flipkart',
      items: newOrderMatch[1].trim(),
      orderId: extractOrderId(combined),
      confidence: amt ? 0.85 : 0.60,
      category: 'platform_pending'
    });
  }

  return null;
}

function parseBankNotification(title, content) {
  const text = title + ' ' + content;

  const creditMatch = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*credited to\s*(?:A\/c|account)\s*[X*x]*(\d{4})/i);
  if (creditMatch) {
    const descMatch = text.match(/credited.*?(\d{4})\.\s*(.+?)(?:\.\s*Bal|$)/i);
    const balMatch = text.match(/Bal[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
    return baseResult({
      amount: parseFloat(creditMatch[1].replace(/,/g, '')),
      type: 'credit',
      method: 'BANK',
      counterparty: descMatch ? descMatch[2].trim().substring(0, 50) : null,
      reference_id: extractUPIRef(text),
      confidence: 0.85
    });
  }

  const debitMatch = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)\s*debited from\s*(?:A\/c|account)\s*[X*x]*(\d{4})/i);
  if (debitMatch) {
    const descMatch = text.match(/debited.*?(\d{4})\.\s*(.+?)(?:\.\s*Bal|$)/i);
    const balMatch = text.match(/Bal[:\s]*₹\s*([\d,]+(?:\.\d{1,2})?)/i);
    return baseResult({
      amount: parseFloat(debitMatch[1].replace(/,/g, '')),
      type: 'debit',
      method: 'BANK',
      counterparty: descMatch ? descMatch[2].trim().substring(0, 50) : null,
      reference_id: extractUPIRef(text),
      confidence: 0.85
    });
  }

  const amt = extractAmount(text);
  if (amt) {
    const isCredit = /credited|received|deposited/i.test(text);
    const isDebit = /debited|withdrawn|sent|paid/i.test(text);
    if (isCredit || isDebit) {
      return baseResult({
        amount: amt,
        type: isCredit ? 'credit' : 'debit',
        method: 'BANK',
        reference_id: extractUPIRef(text),
        confidence: 0.70
      });
    }
  }

  return null;
}

class NotificationParserRegistry {
  constructor() {
    this.parsers = new Map();
    this.registerDefaults();
  }

  register(packageName, parserConfig) {
    this.parsers.set(packageName, parserConfig);
  }

  getParser(packageName) {
    return this.parsers.get(packageName) || null;
  }

  getMonitoredPackages() {
    return [...this.parsers.keys()];
  }

  registerDefaults() {
    this.register('com.google.android.apps.nbu.paisa.user', {
      name: 'Google Pay',
      category: 'upi',
      parse: parseGPay,
      confidence: 0.92,
      alertLevel: 'normal'
    });
    this.register('com.phonepe.app', {
      name: 'PhonePe',
      category: 'upi',
      parse: parsePhonePe,
      confidence: 0.90,
      alertLevel: 'normal'
    });
    this.register('net.one97.paytm', {
      name: 'Paytm',
      category: 'upi',
      parse: parsePaytm,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('in.org.npci.upiapp', {
      name: 'BHIM',
      category: 'upi',
      parse: parseBHIM,
      confidence: 0.90,
      alertLevel: 'normal'
    });

    this.register('com.pinelabs.masterapp', {
      name: 'Pine Labs',
      category: 'pos',
      parse: parsePineLabs,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('com.razorpay.payments.app', {
      name: 'Razorpay',
      category: 'pos',
      parse: parseRazorpay,
      confidence: 0.88,
      alertLevel: 'normal'
    });
    this.register('com.petpooja.app', {
      name: 'Petpooja',
      category: 'pos',
      parse: parsePetpooja,
      confidence: 0.85,
      alertLevel: 'immediate'
    });
    this.register('com.instamojo.app', {
      name: 'Instamojo',
      category: 'pos',
      parse: parseInstamojo,
      confidence: 0.88,
      alertLevel: 'normal'
    });

    this.register('in.swiggy.partner.app', {
      name: 'Swiggy Partner',
      category: 'platform',
      parse: parseSwiggy,
      confidence: 0.90,
      alertLevel: 'immediate'
    });
    this.register('com.application.zomato.merchant', {
      name: 'Zomato Partner',
      category: 'platform',
      parse: parseZomato,
      confidence: 0.90,
      alertLevel: 'immediate'
    });
    this.register('com.amazon.sellermobile.android', {
      name: 'Amazon Seller',
      category: 'platform',
      parse: parseAmazon,
      confidence: 0.85,
      alertLevel: 'normal'
    });
    this.register('com.flipkart.seller', {
      name: 'Flipkart Seller',
      category: 'platform',
      parse: parseFlipkart,
      confidence: 0.85,
      alertLevel: 'normal'
    });

    const bankPackages = [
      'com.sbi.SBIFreedomPlus',
      'com.csam.icici.bank.imobile',
      'com.hdfc.retail.banking',
      'com.axis.mobile',
      'com.kotak.mobile.banking'
    ];
    for (const pkg of bankPackages) {
      this.register(pkg, {
        name: 'Banking App',
        category: 'bank',
        parse: parseBankNotification,
        confidence: 0.85,
        alertLevel: 'normal'
      });
    }
  }
}

module.exports = {
  NotificationParserRegistry,
  parseGPay,
  parsePhonePe,
  parsePaytm,
  parseBHIM,
  parsePineLabs,
  parseRazorpay,
  parsePetpooja,
  parseInstamojo,
  parseSwiggy,
  parseZomato,
  parseAmazon,
  parseFlipkart,
  parseBankNotification
};
