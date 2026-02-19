#!/usr/bin/env node
// Comprehensive test suite for DhandhaPhone data ingestion modules
// Run: DHANDHA_WORKSPACE=/tmp/test-ingestion-$$ node gateway/ingestion/test-ingestion.js

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════
// Setup: temp workspace + DB
// ═══════════════════════════════════════════════════════════════════

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhandha-ingestion-test-'));
process.env.DHANDHA_WORKSPACE = testDir;

// Ensure required subdirectories exist
for (const sub of ['ledger', 'contacts', 'sms', 'accounting', 'ocr', 'pending', 'inventory']) {
  fs.mkdirSync(path.join(testDir, sub), { recursive: true });
}

const { DhandhaDB } = require('../../lib/db/db');
const dbPath = path.join(testDir, 'dhandhaphone.db');
const db = new DhandhaDB(dbPath);

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertApprox(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg} (expected ~${expected}, got ${actual})`);
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

try {

// ═══════════════════════════════════════════════════════════════════
// 1. notification-parser.js
// ═══════════════════════════════════════════════════════════════════

const {
  NotificationParserRegistry,
  parseGPay, parsePhonePe, parsePaytm, parseBHIM,
  parsePineLabs, parseRazorpay, parsePetpooja, parseInstamojo,
  parseSwiggy, parseZomato, parseAmazon, parseFlipkart,
  parseBankNotification
} = require('./notification-parser');

section('1.1 NotificationParserRegistry');

const registry = new NotificationParserRegistry();
const packages = registry.getMonitoredPackages();
assert(packages.length >= 16, `Registry has ${packages.length} monitored packages (>= 16)`);
assert(packages.includes('com.google.android.apps.nbu.paisa.user'), 'GPay package registered');
assert(packages.includes('com.phonepe.app'), 'PhonePe package registered');
assert(packages.includes('net.one97.paytm'), 'Paytm package registered');
assert(packages.includes('in.org.npci.upiapp'), 'BHIM package registered');
assert(packages.includes('com.pinelabs.masterapp'), 'Pine Labs package registered');
assert(packages.includes('com.razorpay.payments.app'), 'Razorpay package registered');
assert(packages.includes('com.petpooja.app'), 'Petpooja package registered');
assert(packages.includes('com.instamojo.app'), 'Instamojo package registered');
assert(packages.includes('in.swiggy.partner.app'), 'Swiggy package registered');
assert(packages.includes('com.application.zomato.merchant'), 'Zomato package registered');
assert(packages.includes('com.amazon.sellermobile.android'), 'Amazon package registered');
assert(packages.includes('com.flipkart.seller'), 'Flipkart package registered');
assert(packages.includes('com.sbi.SBIFreedomPlus'), 'SBI bank package registered');

const gpayEntry = registry.getParser('com.google.android.apps.nbu.paisa.user');
assert(gpayEntry !== null, 'getParser returns GPay entry');
assertEq(gpayEntry.name, 'Google Pay', 'GPay parser name');
assertEq(gpayEntry.category, 'upi', 'GPay parser category');
assert(typeof gpayEntry.parse === 'function', 'GPay parser has parse function');
assertEq(gpayEntry.confidence, 0.92, 'GPay parser confidence');

assert(registry.getParser('com.nonexistent.app') === null, 'getParser returns null for unknown package');

// Register custom parser
registry.register('com.test.custom', { name: 'Test', category: 'test', parse: () => null, confidence: 0.50, alertLevel: 'normal' });
assert(registry.getParser('com.test.custom') !== null, 'Custom parser registered successfully');

section('1.2 parseGPay');

{
  const r = parseGPay('Payment', '₹5,000 sent to RAJAN. UPI Ref: 123456789012');
  assert(r !== null, 'GPay sent to parses');
  assertEq(r.amount, 5000, 'GPay amount');
  assertEq(r.type, 'debit', 'GPay sent = debit');
  assertEq(r.counterparty, 'RAJAN', 'GPay counterparty');
  assertEq(r.reference_id, '123456789012', 'GPay reference_id');
  assertEq(r.confidence, 0.92, 'GPay confidence');
}

{
  const r = parseGPay('Payment', '₹2,500 received from MEENA. UPI Ref: 987654321098');
  assert(r !== null, 'GPay received parses');
  assertEq(r.amount, 2500, 'GPay received amount');
  assertEq(r.type, 'credit', 'GPay received = credit');
  assertEq(r.counterparty, 'MEENA', 'GPay received counterparty');
}

{
  const r = parseGPay('Payment', 'Payment of ₹1,200 received from KUMAR');
  assert(r !== null, 'GPay payment received parses');
  assertEq(r.amount, 1200, 'GPay payment received amount');
  assertEq(r.type, 'credit', 'GPay payment received = credit');
}

{
  const r = parseGPay('Payment', 'You paid ₹800 to SHARMA UPI Ref: 111222333444');
  assert(r !== null, 'GPay You paid parses');
  assertEq(r.amount, 800, 'GPay You paid amount');
  assertEq(r.type, 'debit', 'GPay You paid = debit');
}

{
  const r = parseGPay('₹3,000 received', 'Cashback earned on your purchase');
  assert(r !== null, 'GPay title-only fallback parses');
  assertEq(r.amount, 3000, 'GPay title-only amount');
  assertEq(r.confidence, 0.75, 'GPay title-only lower confidence');
}

{
  const r = parseGPay('Offer for you!', 'Get 10% cashback on your next payment');
  assertEq(r, null, 'GPay promotional returns null');
}

section('1.3 parsePhonePe');

{
  const r = parsePhonePe('Payment Successful', '₹1,500 sent to RAJAN successfully. Ref No: 456789012345');
  assert(r !== null, 'PhonePe sent parses');
  assertEq(r.amount, 1500, 'PhonePe sent amount');
  assertEq(r.type, 'debit', 'PhonePe sent = debit');
  assertEq(r.counterparty, 'RAJAN', 'PhonePe counterparty');
}

{
  const r = parsePhonePe('Money Received', 'Received ₹3,000 from SHARMA. Ref No: 112233445566');
  assert(r !== null, 'PhonePe received parses');
  assertEq(r.amount, 3000, 'PhonePe received amount');
  assertEq(r.type, 'credit', 'PhonePe received = credit');
}

{
  const r = parsePhonePe('Cashback', '₹50 cashback credited to your PhonePe account');
  assert(r !== null, 'PhonePe cashback parses');
  assertEq(r.amount, 50, 'PhonePe cashback amount');
  assertEq(r.type, 'credit', 'PhonePe cashback = credit');
  assertEq(r.category, 'cashback', 'PhonePe cashback category');
  assertEq(r.method, 'WALLET', 'PhonePe cashback method = WALLET');
}

{
  const r = parsePhonePe('Transfer', 'Wallet to bank transfer of ₹5,000');
  assertEq(r, null, 'PhonePe wallet transfer returns null');
}

{
  const r = parsePhonePe('Autopay', 'Autopay of ₹499 for Netflix successful');
  assert(r !== null, 'PhonePe autopay parses');
  assertEq(r.amount, 499, 'PhonePe autopay amount');
  assertEq(r.type, 'debit', 'PhonePe autopay = debit');
  assertEq(r.category, 'recurring', 'PhonePe autopay category');
}

{
  const r = parsePhonePe('Payment', 'Payment of ₹2,000 to RAJAN successful');
  assert(r !== null, 'PhonePe payment-to parses');
  assertEq(r.amount, 2000, 'PhonePe payment-to amount');
  assertEq(r.type, 'debit', 'PhonePe payment-to = debit');
}

section('1.4 parsePaytm');

{
  const r = parsePaytm('Payment', '₹1,000 paid to KUMAR. Order ID: ORD-12345');
  assert(r !== null, 'Paytm paid parses');
  assertEq(r.amount, 1000, 'Paytm paid amount');
  assertEq(r.type, 'debit', 'Paytm paid = debit');
  assertEq(r.counterparty, 'KUMAR', 'Paytm paid counterparty');
  assertEq(r.reference_id, 'ORD-12345', 'Paytm paid order ID');
}

{
  const r = parsePaytm('Payment', '₹500 received from RAJAN.');
  assert(r !== null, 'Paytm received parses');
  assertEq(r.amount, 500, 'Paytm received amount');
  assertEq(r.type, 'credit', 'Paytm received = credit');
}

{
  const r = parsePaytm('Cashback', '₹20 cashback added to your Paytm Wallet');
  assert(r !== null, 'Paytm cashback parses');
  assertEq(r.amount, 20, 'Paytm cashback amount');
  assertEq(r.category, 'cashback', 'Paytm cashback category');
}

{
  const r = parsePaytm('Added', '₹5,000 added to Paytm Wallet');
  assertEq(r, null, 'Paytm wallet add returns null');
}

{
  const r = parsePaytm('Business', '₹800 received. Total today: ₹15,000');
  assert(r !== null, 'Paytm biz received parses');
  assertEq(r.amount, 800, 'Paytm biz received amount');
  assertEq(r.type, 'credit', 'Paytm biz received = credit');
}

{
  const r = parsePaytm('Payment', 'Payment of ₹1,500 for Electricity Bill successful');
  assert(r !== null, 'Paytm payment-for parses');
  assertEq(r.amount, 1500, 'Paytm payment-for amount');
  assertEq(r.type, 'debit', 'Paytm payment-for = debit');
}

section('1.5 parseBHIM');

{
  const r = parseBHIM('Transaction Successful', 'Paid ₹2,000 to rajan@ybl. UPI Ref: 345678901234');
  assert(r !== null, 'BHIM paid parses');
  assertEq(r.amount, 2000, 'BHIM paid amount');
  assertEq(r.type, 'debit', 'BHIM paid = debit');
  assertEq(r.counterparty, 'rajan@ybl', 'BHIM VPA counterparty');
}

{
  const r = parseBHIM('Money Received', 'Received ₹4,000 from sharma@upi. UPI Ref: 567890123456');
  assert(r !== null, 'BHIM received parses');
  assertEq(r.amount, 4000, 'BHIM received amount');
  assertEq(r.type, 'credit', 'BHIM received = credit');
}

{
  const r = parseBHIM('Alert', '₹10,000 debited from A/c 5678');
  assert(r !== null, 'BHIM debited parses');
  assertEq(r.amount, 10000, 'BHIM debited amount');
  assertEq(r.type, 'debit', 'BHIM debited = debit');
}

{
  const r = parseBHIM('Alert', '₹5,000 credited to A/c 1234');
  assert(r !== null, 'BHIM credited parses');
  assertEq(r.amount, 5000, 'BHIM credited amount');
  assertEq(r.type, 'credit', 'BHIM credited = credit');
}

{
  const r = parseBHIM('Transaction Successful', '₹750 transaction completed. UPI Ref: 111222333444');
  assert(r !== null, 'BHIM generic Transaction Successful parses');
  assertEq(r.amount, 750, 'BHIM generic amount');
}

section('1.6 parsePineLabs');

{
  const r = parsePineLabs('Sale', 'Transaction approved ₹3,500 on TXN123456');
  assert(r !== null, 'Pine Labs approved parses');
  assertEq(r.amount, 3500, 'Pine Labs approved amount');
  assertEq(r.method, 'CARD', 'Pine Labs method = CARD');
}

{
  const r = parsePineLabs('Sale', 'Sale of ₹2,500 - Card ending 4321');
  assert(r !== null, 'Pine Labs card sale parses');
  assertEq(r.amount, 2500, 'Pine Labs card sale amount');
  assertEq(r.counterparty, 'Card **4321', 'Pine Labs card counterparty');
}

{
  const r = parsePineLabs('Settlement', 'Daily settlement of ₹25,000 credited to your account');
  assert(r !== null, 'Pine Labs settlement parses');
  assertEq(r.amount, 25000, 'Pine Labs settlement amount');
  assertEq(r.isSettlement, true, 'Pine Labs settlement flag');
  assertEq(r.method, 'BANK', 'Pine Labs settlement method = BANK');
}

section('1.7 parseRazorpay');

{
  const r = parseRazorpay('Payment', '₹8,000 received via upi. Payment ID: pay_ABC123');
  assert(r !== null, 'Razorpay received via UPI parses');
  assertEq(r.amount, 8000, 'Razorpay amount');
  assertEq(r.method, 'UPI', 'Razorpay method = UPI');
  assertEq(r.reference_id, 'pay_ABC123', 'Razorpay payment ID');
}

{
  const r = parseRazorpay('Settlement', 'Your settlement of ₹50,000 has been credited');
  assert(r !== null, 'Razorpay settlement parses');
  assertEq(r.isSettlement, true, 'Razorpay settlement flag');
  assertEq(r.method, 'BANK', 'Razorpay settlement method = BANK');
}

{
  const r = parseRazorpay('Fee', 'Razorpay fee of ₹200 charged');
  assert(r !== null, 'Razorpay fee parses');
  assertEq(r.amount, 200, 'Razorpay fee amount');
  assertEq(r.type, 'debit', 'Razorpay fee = debit');
  assertEq(r.category, 'platform_fee', 'Razorpay fee category');
}

{
  const r = parseRazorpay('Payment', 'Payment of ₹5,000 from KUMAR successful');
  assert(r !== null, 'Razorpay payment-from parses');
  assertEq(r.amount, 5000, 'Razorpay payment-from amount');
  assertEq(r.counterparty, 'KUMAR', 'Razorpay payment-from counterparty');
}

section('1.8 parsePetpooja');

{
  const r = parsePetpooja('Order', 'Order #ORD-001 completed - ₹1,200');
  assert(r !== null, 'Petpooja order completed parses');
  assertEq(r.amount, 1200, 'Petpooja order amount');
  assertEq(r.orderId, 'ORD-001', 'Petpooja order ID');
}

{
  const r = parsePetpooja('Table', 'Table 5 - Bill ₹2,800');
  assert(r !== null, 'Petpooja table bill parses');
  assertEq(r.amount, 2800, 'Petpooja bill amount');
  assertEq(r.counterparty, 'Table 5', 'Petpooja table counterparty');
}

{
  const r = parsePetpooja('New Order', 'New Order #ORD-050 - ₹900');
  assert(r !== null, 'Petpooja new order parses');
  assertEq(r.category, 'platform_pending', 'Petpooja new order = platform_pending');
  assertEq(r.confidence, 0.70, 'Petpooja new order lower confidence');
}

{
  const r = parsePetpooja('KOT', 'KOT for Table 3: 2x Paneer Tikka');
  assertEq(r, null, 'Petpooja KOT without amount returns null');
}

section('1.9 parseInstamojo');

{
  const r = parseInstamojo('Payment', '₹3,000 payment link paid by SHARMA.');
  assert(r !== null, 'Instamojo link payment parses');
  assertEq(r.amount, 3000, 'Instamojo link amount');
  assertEq(r.counterparty, 'SHARMA', 'Instamojo link counterparty');
}

{
  const r = parseInstamojo('Payout', 'Your payout of ₹10,000 is processing');
  assert(r !== null, 'Instamojo payout parses');
  assertEq(r.isSettlement, true, 'Instamojo payout = settlement');
}

{
  const r = parseInstamojo('Payment', 'Payment of ₹1,500 received');
  assert(r !== null, 'Instamojo generic payment received parses');
  assertEq(r.amount, 1500, 'Instamojo generic payment amount');
}

section('1.10 parseSwiggy');

{
  const r = parseSwiggy('New Order', 'New order! #SWG-101 - 2x Butter Chicken - ₹650');
  assert(r !== null, 'Swiggy new order parses');
  assertEq(r.amount, 650, 'Swiggy order amount');
  assertEq(r.orderId, 'SWG-101', 'Swiggy order ID');
  assertEq(r.items, '2x Butter Chicken', 'Swiggy items');
  assertEq(r.category, 'platform_pending', 'Swiggy order = platform_pending');
  assertEq(r.counterparty, 'Swiggy', 'Swiggy counterparty');
}

{
  const r = parseSwiggy('Payout', 'Weekly payout: ₹15,000');
  assert(r !== null, 'Swiggy payout parses');
  assertEq(r.isSettlement, true, 'Swiggy payout = settlement');
  assertEq(r.counterparty, 'Swiggy Payout', 'Swiggy payout counterparty');
}

{
  const r = parseSwiggy('Summary', 'Daily summary: 12 orders, ₹8,400');
  assert(r !== null, 'Swiggy daily summary parses');
  assertEq(r.amount, 8400, 'Swiggy summary amount');
  assertEq(r.category, 'daily_summary', 'Swiggy summary category');
}

{
  const r = parseSwiggy('Delivery', 'Order #SWG-101 picked up by delivery partner');
  assertEq(r, null, 'Swiggy delivery status returns null');
}

section('1.11 parseZomato');

{
  const r = parseZomato('Order', 'Order #ZMT-200: 1x Biryani - ₹350');
  assert(r !== null, 'Zomato order with items parses');
  assertEq(r.amount, 350, 'Zomato order amount');
  assertEq(r.orderId, 'ZMT-200', 'Zomato order ID');
  assertEq(r.category, 'platform_pending', 'Zomato order = platform_pending');
}

{
  const r = parseZomato('Payout', 'Payout processed: ₹20,000');
  assert(r !== null, 'Zomato payout parses');
  assertEq(r.isSettlement, true, 'Zomato payout = settlement');
  assertEq(r.counterparty, 'Zomato Payout', 'Zomato payout counterparty');
}

{
  const r = parseZomato('Earnings', 'Daily earnings: ₹5,600 from 8 orders');
  assert(r !== null, 'Zomato daily earnings parses');
  assertEq(r.amount, 5600, 'Zomato earnings amount');
  assertEq(r.category, 'daily_summary', 'Zomato earnings category');
}

{
  const r = parseZomato('Order', 'New order #ZMT-300 from Sector 12.');
  assert(r !== null, 'Zomato new order without amount parses');
  assertEq(r.orderId, 'ZMT-300', 'Zomato new order ID');
  assertEq(r.confidence, 0.70, 'Zomato no-amount lower confidence');
}

section('1.12 parseAmazon');

{
  const r = parseAmazon('New Order', 'New order: Bluetooth Speaker - ₹1,999. #AMZ-100');
  assert(r !== null, 'Amazon new order parses');
  assertEq(r.amount, 1999, 'Amazon order amount');
  assertEq(r.category, 'platform_pending', 'Amazon order = platform_pending');
  assertEq(r.items, 'Bluetooth Speaker', 'Amazon order items');
}

{
  const r = parseAmazon('Settlement', 'Payment of ₹50,000 deposited to your bank account');
  assert(r !== null, 'Amazon settlement parses');
  assertEq(r.isSettlement, true, 'Amazon settlement flag');
  assertEq(r.amount, 50000, 'Amazon settlement amount');
}

{
  const r = parseAmazon('Return', 'Return requested for order #AMZ-050. ₹999');
  assert(r !== null, 'Amazon return parses');
  assertEq(r.type, 'debit', 'Amazon return = debit');
  assertEq(r.category, 'return', 'Amazon return category');
}

{
  const r = parseAmazon('Shipping', 'Your order has shipped');
  assertEq(r, null, 'Amazon shipping returns null');
}

section('1.13 parseFlipkart');

{
  const r = parseFlipkart('New Order', 'New order for Wireless Earbuds. #FK-500 ₹1,299');
  assert(r !== null, 'Flipkart new order parses');
  assertEq(r.category, 'platform_pending', 'Flipkart order = platform_pending');
  assertEq(r.items, 'Wireless Earbuds', 'Flipkart order items');
}

{
  const r = parseFlipkart('Settlement', 'Settlement of ₹30,000 completed');
  assert(r !== null, 'Flipkart settlement parses');
  assertEq(r.isSettlement, true, 'Flipkart settlement flag');
  assertEq(r.amount, 30000, 'Flipkart settlement amount');
}

{
  const r = parseFlipkart('Payment', '₹25,000 payment processed for your sales');
  assert(r !== null, 'Flipkart payment processed parses');
  assertEq(r.isSettlement, true, 'Flipkart payment processed = settlement');
}

{
  const r = parseFlipkart('Return', 'Return initiated for order #FK-300. ₹599');
  assert(r !== null, 'Flipkart return parses');
  assertEq(r.type, 'debit', 'Flipkart return = debit');
  assertEq(r.category, 'return', 'Flipkart return category');
}

section('1.14 parseBankNotification');

{
  const r = parseBankNotification('SBI Alert', '₹10,000 credited to A/c XX1234. UPI Ref: 112233445566. Bal: ₹50,000');
  assert(r !== null, 'Bank credit notification parses');
  assertEq(r.amount, 10000, 'Bank credit amount');
  assertEq(r.type, 'credit', 'Bank credit type');
  assertEq(r.method, 'BANK', 'Bank credit method');
  assertEq(r.reference_id, '112233445566', 'Bank credit ref');
}

{
  const r = parseBankNotification('HDFC Alert', '₹5,000 debited from A/c XX5678. UPI Ref: 665544332211. Bal: ₹45,000');
  assert(r !== null, 'Bank debit notification parses');
  assertEq(r.amount, 5000, 'Bank debit amount');
  assertEq(r.type, 'debit', 'Bank debit type');
}

{
  const r = parseBankNotification('Alert', '₹2,000 deposited into your account');
  assert(r !== null, 'Bank generic credit parses');
  assertEq(r.type, 'credit', 'Bank generic deposited = credit');
  assertEq(r.confidence, 0.70, 'Bank generic lower confidence');
}

{
  const r = parseBankNotification('Promo', 'New savings account offer for you!');
  assertEq(r, null, 'Bank promotional returns null');
}

section('1.15 Edge cases for parsers');

assertEq(parseGPay(null, null), null, 'GPay null input returns null');
assertEq(parseGPay('', ''), null, 'GPay empty input returns null');
assertEq(parsePhonePe('', ''), null, 'PhonePe empty input returns null');
assertEq(parsePaytm('', ''), null, 'Paytm empty input returns null');

// ═══════════════════════════════════════════════════════════════════
// 2. dedup.js
// ═══════════════════════════════════════════════════════════════════

const { DedupEngine } = require('./dedup');

section('2.1 DedupEngine - computeHash');

const dedup = new DedupEngine(db);

{
  const hash1 = dedup.computeHash({ amount: 5000, transaction_date: '2026-02-18T10:30:00', reference_id: 'REF001' });
  const hash2 = dedup.computeHash({ amount: 5000, transaction_date: '2026-02-18T15:00:00', reference_id: 'REF001' });
  assertEq(hash1, hash2, 'computeHash same day = same hash (date normalized to YYYY-MM-DD)');
}

{
  const hash1 = dedup.computeHash({ amount: 5000, transaction_date: '2026-02-18', reference_id: 'REF001' });
  const hash2 = dedup.computeHash({ amount: 5001, transaction_date: '2026-02-18', reference_id: 'REF001' });
  assert(hash1 !== hash2, 'computeHash different amount = different hash');
}

{
  const hash1 = dedup.computeHash({ amount: 5000, transaction_date: '2026-02-18', reference_id: 'REF001' });
  const hash2 = dedup.computeHash({ amount: 5000, transaction_date: '2026-02-18', reference_id: 'REF002' });
  assert(hash1 !== hash2, 'computeHash different ref = different hash');
}

{
  const hash = dedup.computeHash({ amount: 1000, transaction_date: '2026-02-20', reference_id: null });
  assert(typeof hash === 'string' && hash.length === 64, 'computeHash returns SHA256 hex string');
}

section('2.2 DedupEngine - nameSimilarity');

assertEq(dedup.nameSimilarity('RAJAN', 'rajan'), 1.0, 'nameSimilarity exact match case-insensitive');
assertEq(dedup.nameSimilarity('RAJAN KUMAR', 'rajan'), 0.8, 'nameSimilarity containment');
assertEq(dedup.nameSimilarity('rajan', 'RAJAN KUMAR'), 0.8, 'nameSimilarity reverse containment');
assertEq(dedup.nameSimilarity(null, 'rajan'), 0.0, 'nameSimilarity null returns 0');
assertEq(dedup.nameSimilarity('', 'rajan'), 0.0, 'nameSimilarity empty returns 0');
assert(dedup.nameSimilarity('rajan', 'rajam') > 0.5, 'nameSimilarity close names > 0.5');
assert(dedup.nameSimilarity('rajan', 'sharma') < 0.5, 'nameSimilarity different names < 0.5');

section('2.3 DedupEngine - Tier 1 (reference_id match)');

{
  // Insert a transaction with a reference_id
  const txnId = db.addTransaction({
    type: 'credit', amount: 7500, counterparty_name: 'Sharma',
    method: 'UPI', source: 'sms', reference_id: 'UPIREF_TIER1_TEST',
    transaction_date: '2026-02-20'
  });

  const result = dedup.isDuplicate({
    amount: 7500, type: 'credit', reference_id: 'UPIREF_TIER1_TEST',
    counterparty: 'Sharma', transaction_date: '2026-02-20T10:00:00'
  }, 'notification');

  assert(result.isDupe === true, 'Tier 1 detects duplicate by reference_id');
  assertEq(result.tier, 1, 'Tier 1 returns tier=1');
  assertEq(result.confidence, 1.0, 'Tier 1 confidence = 1.0');
  assertEq(result.matchedTxnId, txnId, 'Tier 1 returns matched transaction ID');
}

section('2.4 DedupEngine - Tier 2 (hash match)');

{
  // Insert a transaction and record its hash in dedup log
  const txnId = db.addTransaction({
    type: 'debit', amount: 3000, counterparty_name: 'Kumar',
    method: 'UPI', source: 'notification', reference_id: 'HASH_TEST_REF',
    transaction_date: '2026-02-20'
  });

  dedup.recordTransaction({
    amount: 3000, type: 'debit', reference_id: 'HASH_TEST_REF',
    transaction_date: '2026-02-20T12:00:00'
  }, 'notification', txnId);

  // Now check from SMS perspective (different source) but delete the
  // transaction so Tier 1 won't find it via reference_id
  db.softDeleteTransaction(txnId);

  const result = dedup.isDuplicate({
    amount: 3000, type: 'debit', reference_id: 'HASH_TEST_REF',
    counterparty: 'Kumar', transaction_date: '2026-02-20T12:00:00'
  }, 'sms');

  assert(result.isDupe === true, 'Tier 2 detects duplicate by hash');
  assertEq(result.tier, 2, 'Tier 2 returns tier=2');
  assertEq(result.confidence, 0.95, 'Tier 2 confidence = 0.95');
}

section('2.5 DedupEngine - Tier 3 (fuzzy match)');

{
  // Insert a transaction with no reference_id (so Tier 1 can't match)
  const txnId = db.addTransaction({
    type: 'credit', amount: 2500, counterparty_name: 'MEENA STORE',
    method: 'CASH', source: 'voice', reference_id: null,
    transaction_date: '2026-02-20'
  });

  // Check from notification channel - same amount, type, within window
  const result = dedup.isDuplicate({
    amount: 2500, type: 'credit', reference_id: null,
    counterparty: 'MEENA STORE', transaction_date: '2026-02-20T00:05:00'
  }, 'notification');

  assert(result.isDupe === true, 'Tier 3 fuzzy match detects duplicate');
  assertEq(result.tier, 3, 'Tier 3 returns tier=3');
  assertEq(result.confidence, 0.80, 'Tier 3 confidence = 0.80');
}

{
  // Different counterparty names should prevent fuzzy match
  const txnId2 = db.addTransaction({
    type: 'credit', amount: 1500, counterparty_name: 'RAJAN',
    method: 'UPI', source: 'sms', reference_id: null,
    transaction_date: '2026-02-20'
  });

  const result2 = dedup.isDuplicate({
    amount: 1500, type: 'credit', reference_id: null,
    counterparty: 'SHARMA TRADING CO', transaction_date: '2026-02-20T00:05:00'
  }, 'notification');

  assertEq(result2.isDupe, false, 'Tier 3 rejects fuzzy match with different counterparty');
}

section('2.6 DedupEngine - recordTransaction');

{
  const testTxnId = db.addTransaction({
    type: 'credit', amount: 9999, counterparty_name: 'RecordTest',
    method: 'UPI', source: 'sms', reference_id: 'REC_TEST_001',
    transaction_date: '2026-02-20'
  });

  dedup.recordTransaction({
    amount: 9999, reference_id: 'REC_TEST_001', transaction_date: '2026-02-20'
  }, 'sms', testTxnId);

  const hash = dedup.computeHash({ amount: 9999, reference_id: 'REC_TEST_001', transaction_date: '2026-02-20' });
  const entry = db.getDedupByHash(hash);
  assert(entry !== null, 'recordTransaction creates dedup entry');
  assertEq(entry.source, 'sms', 'recordTransaction dedup entry has correct source');
}

section('2.7 DedupEngine - no duplicate for new transaction');

{
  const result = dedup.isDuplicate({
    amount: 77777, type: 'credit', reference_id: 'BRAND_NEW_REF',
    counterparty: 'BRAND NEW PERSON', transaction_date: '2026-02-20T14:00:00'
  }, 'sms');

  assertEq(result.isDupe, false, 'isDuplicate returns false for genuinely new transaction');
}

// ═══════════════════════════════════════════════════════════════════
// 3. vpa-resolver.js
// ═══════════════════════════════════════════════════════════════════

const { VPAResolver } = require('./vpa-resolver');

section('3.1 VPAResolver - known VPA mapping');

const vpaResolver = new VPAResolver(db);

{
  // Add a contact and a known VPA mapping
  const contactId = db.addContact({ name: 'Rajan Kumar', phone: '+919876543210', type: 'customer' });
  db.saveVPAMapping('rajan@ybl', contactId, 'Rajan Kumar');

  const result = vpaResolver.resolve('rajan@ybl');
  assert(result !== null, 'VPA resolve returns known mapping');
  assertEq(result.contact_id, contactId, 'VPA resolve returns correct contact_id');
  assertEq(result.contact_name, 'Rajan Kumar', 'VPA resolve returns correct contact_name');
}

section('3.2 VPAResolver - phone number VPA');

{
  // Contact already created above with phone +919876543210
  const result = vpaResolver.resolve('9876543210@upi');
  assert(result !== null, 'VPA phone-number resolution works');
  assertEq(result.contact_name, 'Rajan Kumar', 'Phone VPA maps to correct contact');
}

section('3.3 VPAResolver - name-based VPA');

{
  // Add a unique contact
  const contactId = db.addContact({ name: 'sharma traders', phone: '+919111222333', type: 'supplier' });

  const result = vpaResolver.resolve('sharma_traders@paytm');
  assert(result !== null, 'Name-based VPA resolution works');
  assertEq(result.contact_name, 'sharma traders', 'Name VPA maps to correct contact');
}

section('3.4 VPAResolver - ambiguous match returns null');

{
  // Add two contacts with similar names so the lookup is ambiguous
  db.addContact({ name: 'kumar store east', phone: '+919444555666', type: 'customer' });
  db.addContact({ name: 'kumar store west', phone: '+919444555777', type: 'customer' });

  const result = vpaResolver.resolve('kumar_store@paytm');
  assertEq(result, null, 'Ambiguous VPA match returns null');
}

section('3.5 VPAResolver - extractVPA');

{
  const vpa1 = vpaResolver.extractVPA('Payment from rajan@ybl via UPI');
  assertEq(vpa1, 'rajan@ybl', 'extractVPA finds VPA in text');
}

{
  const vpa2 = vpaResolver.extractVPA('No VPA here just text');
  assertEq(vpa2, null, 'extractVPA returns null when no VPA');
}

{
  const vpa3 = vpaResolver.extractVPA(null);
  assertEq(vpa3, null, 'extractVPA returns null for null input');
}

{
  const vpa4 = vpaResolver.extractVPA('Paid to sharma.store-1@paytm successfully');
  assertEq(vpa4, 'sharma.store-1@paytm', 'extractVPA handles dots and hyphens in VPA');
}

// ═══════════════════════════════════════════════════════════════════
// 4. confidence.js
// ═══════════════════════════════════════════════════════════════════

const {
  getConfidence, shouldAutoConfirm, shouldAskOwner, shouldSkip, getDecision, CONFIDENCE_MAP
} = require('./confidence');

section('4.1 getConfidence for known channel:subtype combinations');

assertEq(getConfidence('sms', 'with_ref'), 0.90, 'sms:with_ref = 0.90');
assertEq(getConfidence('sms', 'without_ref'), 0.80, 'sms:without_ref = 0.80');
assertEq(getConfidence('notification', 'upi_with_ref'), 0.92, 'notification:upi_with_ref = 0.92');
assertEq(getConfidence('notification', 'upi_without_ref'), 0.75, 'notification:upi_without_ref = 0.75');
assertEq(getConfidence('notification', 'pos'), 0.88, 'notification:pos = 0.88');
assertEq(getConfidence('notification', 'platform_order'), 0.90, 'notification:platform_order = 0.90');
assertEq(getConfidence('notification', 'platform_settlement'), 0.95, 'notification:platform_settlement = 0.95');
assertEq(getConfidence('notification', 'bank'), 0.85, 'notification:bank = 0.85');
assertEq(getConfidence('voice', 'clear'), 0.75, 'voice:clear = 0.75');
assertEq(getConfidence('voice', 'ambiguous'), 0.50, 'voice:ambiguous = 0.50');
assertEq(getConfidence('photo', 'printed'), 0.80, 'photo:printed = 0.80');
assertEq(getConfidence('photo', 'handwritten'), 0.60, 'photo:handwritten = 0.60');
assertEq(getConfidence('photo', 'screenshot'), 0.90, 'photo:screenshot = 0.90');
assertEq(getConfidence('forwarded', 'parsed'), 0.75, 'forwarded:parsed = 0.75');
assertEq(getConfidence('forwarded', 'partial'), 0.60, 'forwarded:partial = 0.60');
assertEq(getConfidence('bulk', 'csv'), 0.95, 'bulk:csv = 0.95');
assertEq(getConfidence('bulk', 'pdf'), 0.90, 'bulk:pdf = 0.90');
assertEq(getConfidence('bulk', 'photo'), 0.75, 'bulk:photo = 0.75');
assertEq(getConfidence('eod', 'confirmed'), 1.00, 'eod:confirmed = 1.00');
assertEq(getConfidence('eod', 'gap_fill'), 0.70, 'eod:gap_fill = 0.70');

section('4.2 getConfidence default fallback');

assertEq(getConfidence('unknown', 'unknown'), 0.50, 'Unknown channel:subtype defaults to 0.50');
assertEq(getConfidence('fax', 'scan'), 0.50, 'Nonsense channel defaults to 0.50');

section('4.3 shouldAutoConfirm thresholds');

assertEq(shouldAutoConfirm(0.80), true, 'shouldAutoConfirm(0.80) = true');
assertEq(shouldAutoConfirm(0.90), true, 'shouldAutoConfirm(0.90) = true');
assertEq(shouldAutoConfirm(0.79), false, 'shouldAutoConfirm(0.79) = false');
assertEq(shouldAutoConfirm(0.50), false, 'shouldAutoConfirm(0.50) = false');

section('4.4 shouldAskOwner thresholds');

assertEq(shouldAskOwner(0.75), true, 'shouldAskOwner(0.75) = true');
assertEq(shouldAskOwner(0.60), true, 'shouldAskOwner(0.60) = true');
assertEq(shouldAskOwner(0.80), false, 'shouldAskOwner(0.80) = false (auto_confirm)');
assertEq(shouldAskOwner(0.59), false, 'shouldAskOwner(0.59) = false (skip)');

section('4.5 shouldSkip thresholds');

assertEq(shouldSkip(0.59), true, 'shouldSkip(0.59) = true');
assertEq(shouldSkip(0.50), true, 'shouldSkip(0.50) = true');
assertEq(shouldSkip(0.60), false, 'shouldSkip(0.60) = false');

section('4.6 getDecision');

assertEq(getDecision(0.95), 'auto_confirm', 'getDecision(0.95) = auto_confirm');
assertEq(getDecision(0.80), 'auto_confirm', 'getDecision(0.80) = auto_confirm');
assertEq(getDecision(0.70), 'ask_owner', 'getDecision(0.70) = ask_owner');
assertEq(getDecision(0.50), 'skip', 'getDecision(0.50) = skip');
assertEq(getDecision(0.30), 'skip', 'getDecision(0.30) = skip');

// ═══════════════════════════════════════════════════════════════════
// 5. notification-poller.js
// ═══════════════════════════════════════════════════════════════════

const { NotificationPoller } = require('./notification-poller');

section('5.1 NotificationPoller - constructor wires dependencies');

const poller = new NotificationPoller(db);
assert(poller.registry instanceof NotificationParserRegistry, 'Poller has registry');
assert(poller.dedup instanceof DedupEngine, 'Poller has dedup engine');
assert(poller.vpaResolver instanceof VPAResolver, 'Poller has VPA resolver');
assert(typeof poller.platformAccountant === 'object', 'Poller has platform accountant');

section('5.2 NotificationPoller - hashNotification consistency');

{
  const notif = {
    packageName: 'com.google.android.apps.nbu.paisa.user',
    id: 'notif-001',
    when: '2026-02-20T10:00:00',
    content: '₹5,000 sent to RAJAN'
  };
  const hash1 = poller.hashNotification(notif);
  const hash2 = poller.hashNotification(notif);
  assertEq(hash1, hash2, 'hashNotification produces consistent hashes');
  assertEq(hash1.length, 64, 'hashNotification returns SHA256 hex');
}

{
  const notifA = { packageName: 'com.test', id: '1', when: '100', content: 'Hello' };
  const notifB = { packageName: 'com.test', id: '2', when: '100', content: 'Hello' };
  assert(poller.hashNotification(notifA) !== poller.hashNotification(notifB), 'Different notif IDs produce different hashes');
}

section('5.3 NotificationPoller - processNotification with GPay notification');

{
  const notif = {
    packageName: 'com.google.android.apps.nbu.paisa.user',
    id: 'test-notif-gpay-001',
    title: 'Payment Received',
    content: '₹8,500 received from MEENA. UPI Ref: 999888777666',
    when: new Date().toISOString()
  };

  const result = poller.processNotification(notif);
  assert(result !== null, 'processNotification returns result for GPay credit');
  assertEq(result.app, 'Google Pay', 'processNotification identifies app');
  assertEq(result.amount, 8500, 'processNotification extracts amount');
  assertEq(result.type, 'credit', 'processNotification extracts type');
  assertEq(result.counterparty, 'MEENA', 'processNotification extracts counterparty');
  assert(result.transaction_id > 0, 'processNotification creates transaction in DB');
  assert(result.confidence > 0, 'processNotification assigns confidence');
  assert(typeof result.decision === 'string', 'processNotification assigns decision');
}

section('5.4 NotificationPoller - notification-level dedup');

{
  const notif = {
    packageName: 'com.google.android.apps.nbu.paisa.user',
    id: 'test-notif-dedup-001',
    title: 'Payment',
    content: '₹1,000 sent to DUPLICATE_TEST. UPI Ref: 111000111000',
    when: new Date().toISOString()
  };

  const result1 = poller.processNotification(notif);
  assert(result1 !== null, 'First notification processes successfully');

  const result2 = poller.processNotification(notif);
  assertEq(result2, null, 'Same notification processed twice returns null');
}

section('5.5 NotificationPoller - platform order routing');

{
  const swiggyNotif = {
    packageName: 'in.swiggy.partner.app',
    id: 'swiggy-order-test-001',
    title: 'New Order',
    content: 'New order! #SWG-ROUTE-01 - 1x Biryani - ₹450',
    when: new Date().toISOString()
  };

  const result = poller.processNotification(swiggyNotif);
  assert(result !== null, 'Platform order notification processes');
  assertEq(result.category, 'platform_order', 'Platform order category');
  assertEq(result.type, 'pending_credit', 'Platform order type = pending_credit');
  assertEq(result.decision, 'platform_pending', 'Platform order decision');
  assertEq(result.counterparty, 'Swiggy', 'Platform order counterparty = Swiggy');
}

// ═══════════════════════════════════════════════════════════════════
// 6. forwarded-message-parser.js
// ═══════════════════════════════════════════════════════════════════

const { parseForwardedMessage } = require('./forwarded-message-parser');

section('6.1 parseForwardedMessage - WhatsApp forwarded bank SMS');

{
  const text = `---------- Forwarded message ---------
₹15,000 credited to A/c XX1234. UPI Ref: 123456789012. Bal: ₹75,000`;
  const r = parseForwardedMessage(text);
  assert(r !== null, 'Forwarded bank SMS parses');
  assertEq(r.amount, 15000, 'Forwarded bank SMS amount');
  assertEq(r.source, 'forwarded', 'Forwarded source tag');
}

section('6.2 parseForwardedMessage - Telegram forwarded UPI confirmation');

{
  const text = `Forwarded from Payment Bot
₹5,000 sent to RAJAN via UPI. UPI Ref: 998877665544`;
  const r = parseForwardedMessage(text);
  assert(r !== null, 'Telegram forwarded UPI parses');
  assertEq(r.amount, 5000, 'Telegram forwarded amount');
  assertEq(r.type, 'debit', 'Telegram forwarded sent = debit');
  assertEq(r.counterparty, 'RAJAN', 'Telegram forwarded counterparty');
}

section('6.3 parseForwardedMessage - Email forwarded receipt');

{
  const text = `From: bank@sbi.co.in
Date: 20 Feb 2026
Subject: Transaction Alert
₹3,000 received from KUMAR via NEFT`;
  const r = parseForwardedMessage(text);
  assert(r !== null, 'Email forwarded receipt parses');
  assertEq(r.amount, 3000, 'Email forwarded amount');
  assertEq(r.type, 'credit', 'Email forwarded received = credit');
}

section('6.4 parseForwardedMessage - UPI pattern extraction');

{
  const text = '₹5,000 sent to RAJAN via UPI. Ref: 123456789012';
  const r = parseForwardedMessage(text);
  assert(r !== null, 'UPI pattern parses');
  assertEq(r.amount, 5000, 'UPI pattern amount');
  assertEq(r.type, 'debit', 'UPI sent = debit');
  assertEq(r.counterparty, 'RAJAN', 'UPI counterparty extracted');
  // SMS parser catches this first with method: 'OTHER' (generic UPI text)
  assert(r.method === 'UPI' || r.method === 'OTHER', 'UPI or OTHER method detected');
}

section('6.5 parseForwardedMessage - generic amount extraction fallback');

{
  const text = 'Rs. 2,500 paid via NEFT for purchase';
  const r = parseForwardedMessage(text);
  assert(r !== null, 'Generic amount extracts');
  assertEq(r.amount, 2500, 'Generic amount value');
  assertEq(r.type, 'debit', 'Generic paid = debit');
  assertEq(r.method, 'NEFT', 'Generic NEFT method detected');
  // SMS parser may catch this at 0.75, else generic fallback at 0.55
  assert(r.confidence === 0.55 || r.confidence === 0.75, 'Generic or SMS confidence');
}

section('6.6 parseForwardedMessage - null return for unparseable text');

assertEq(parseForwardedMessage(null), null, 'null input returns null');
assertEq(parseForwardedMessage(''), null, 'empty string returns null');
assertEq(parseForwardedMessage('Hello, how are you today?'), null, 'Non-financial text returns null');
assertEq(parseForwardedMessage('Meeting at 3 PM'), null, 'Irrelevant text returns null');

// ═══════════════════════════════════════════════════════════════════
// 7. eod-reconciliation.js
// ═══════════════════════════════════════════════════════════════════

const {
  EODReconciliation, formatIndianNumber, getClosedMessage, getGapMessage, getCorrectionsAckMessage
} = require('./eod-reconciliation');

section('7.1 formatIndianNumber');

assertEq(formatIndianNumber(100), '100', 'formatIndianNumber(100)');
assertEq(formatIndianNumber(1234), '1,234', 'formatIndianNumber(1234)');
assertEq(formatIndianNumber(1234567), '12,34,567', 'formatIndianNumber(1234567)');
assertEq(formatIndianNumber(12345678), '1,23,45,678', 'formatIndianNumber(12345678)');
assertEq(formatIndianNumber(0), '0', 'formatIndianNumber(0)');
assertEq(formatIndianNumber(-5000), '-5,000', 'formatIndianNumber(-5000)');
assertEq(formatIndianNumber(99.50), '99.50', 'formatIndianNumber with decimals');
assertEq(formatIndianNumber(null), '0', 'formatIndianNumber(null)');
assertEq(formatIndianNumber(NaN), '0', 'formatIndianNumber(NaN)');

section('7.2 EODReconciliation - generateSummary');

const eod = new EODReconciliation(db);

{
  // Add some transactions for today so we have data to summarize
  const today = new Date().toISOString().split('T')[0];
  db.addTransaction({
    type: 'credit', amount: 10000, counterparty_name: 'EOD Test Credit',
    method: 'UPI', source: 'sms', transaction_date: today
  });
  db.addTransaction({
    type: 'debit', amount: 3000, counterparty_name: 'EOD Test Debit',
    method: 'UPI', source: 'sms', transaction_date: today
  });

  const summary = eod.generateSummary(today, 'en');
  assert(summary.totalCredit >= 10000, 'EOD summary has credits');
  assert(summary.totalDebit >= 3000, 'EOD summary has debits');
  assert(summary.net === summary.totalCredit - summary.totalDebit, 'EOD net = credit - debit');
  assert(summary.txnCount >= 2, 'EOD txn count >= 2');
  assert(summary.text.includes('in'), 'EOD English template has "in"');
  assert(summary.text.includes('out'), 'EOD English template has "out"');
}

section('7.3 EODReconciliation - generateSummary in multiple languages');

{
  const today = new Date().toISOString().split('T')[0];

  const hiSummary = eod.generateSummary(today, 'hi');
  assert(hiSummary.text.includes('aaya'), 'Hindi EOD has "aaya"');

  const teSummary = eod.generateSummary(today, 'te');
  assert(teSummary.text.includes('vachindi'), 'Telugu EOD has "vachindi"');

  const taSummary = eod.generateSummary(today, 'ta');
  assert(taSummary.text.includes('vanthuchu'), 'Tamil EOD has "vanthuchu"');
}

section('7.4 EODReconciliation - classifyResponse');

{
  const r = eod.classifyResponse('sahi hai');
  assertEq(r.type, 'confirmed', 'classifyResponse: "sahi hai" = confirmed');
}

{
  const r = eod.classifyResponse('correct');
  assertEq(r.type, 'confirmed', 'classifyResponse: "correct" = confirmed');
}

{
  const r = eod.classifyResponse('ok');
  assertEq(r.type, 'confirmed', 'classifyResponse: "ok" = confirmed');
}

{
  const r = eod.classifyResponse('haan');
  assertEq(r.type, 'confirmed', 'classifyResponse: "haan" = confirmed');
}

{
  const r = eod.classifyResponse('total tha 45000');
  assertEq(r.type, 'different_total', 'classifyResponse: "total tha 45000" = different_total');
  assertEq(r.amount, 45000, 'classifyResponse: total amount = 45000');
}

{
  const r = eod.classifyResponse('total was ₹32,500');
  assertEq(r.type, 'different_total', 'classifyResponse: "total was 32,500" = different_total');
  assertEq(r.amount, 32500, 'classifyResponse: total amount = 32500');
}

{
  const r = eod.classifyResponse('ek transaction galat hai');
  assertEq(r.type, 'corrections', 'classifyResponse: "galat" = corrections');
}

{
  const r = eod.classifyResponse('cancel karo last wala');
  assertEq(r.type, 'corrections', 'classifyResponse: "cancel" = corrections');
}

{
  const r = eod.classifyResponse('Aur ek 500 ka tha cash mein');
  assertEq(r.type, 'additional', 'classifyResponse: additional dictation');
}

section('7.5 EODReconciliation - processReconciliation');

{
  const today = new Date().toISOString().split('T')[0];

  const result = eod.processReconciliation('sahi hai', today, 'en');
  assertEq(result.action, 'closed', 'processReconciliation confirmed = closed');
  assert(result.message.includes('closed'), 'Closed message in English');
}

{
  const today = new Date().toISOString().split('T')[0];

  const result = eod.processReconciliation('total tha 50000', today, 'hi');
  assertEq(result.action, 'gap_found', 'processReconciliation total override = gap_found');
  assert(typeof result.gap === 'number', 'processReconciliation returns gap amount');
  assert(result.message.includes('gap'), 'Gap message has "gap" keyword');
}

{
  const today = new Date().toISOString().split('T')[0];

  const result = eod.processReconciliation('galat hai ye entry', today, 'en');
  assertEq(result.action, 'corrections', 'processReconciliation corrections');
  assert(result.message.includes('corrections') || result.message.includes('Corrections'),
    'Corrections ack message');
}

{
  const today = new Date().toISOString().split('T')[0];

  const result = eod.processReconciliation('2000 ka cash aaya sharma se', today, 'en');
  assertEq(result.action, 'additional', 'processReconciliation additional = additional');
  assertEq(result.message, null, 'Additional has null message (handed to voice pipeline)');
}

section('7.6 Localized message helpers');

assert(getClosedMessage('hi').includes('Kal milte'), 'Hindi closed message');
assert(getClosedMessage('en').includes('tomorrow'), 'English closed message');
assert(getGapMessage(5000, 'en').includes('5,000'), 'English gap message with amount');
assert(getCorrectionsAckMessage('te').includes('Corrections'), 'Telugu corrections ack');

// ═══════════════════════════════════════════════════════════════════
// 8. platform-accounting.js
// ═══════════════════════════════════════════════════════════════════

const { PlatformAccountant, PLATFORM_COMMISSION_RATES } = require('./platform-accounting');

section('8.1 PlatformAccountant - logPlatformOrder');

const platformAcct = new PlatformAccountant(db);

{
  const txnId = platformAcct.logPlatformOrder({
    amount: 850, orderId: 'SWG-PA-001', items: '1x Biryani', confidence: 0.90
  }, 'Swiggy');

  assert(txnId > 0, 'logPlatformOrder returns transaction ID');

  // Verify the transaction was created correctly
  const txns = db.getTransactions({ counterparty_name: 'Swiggy Order' });
  const found = txns.find(t => t.reference_id === 'SWG-PA-001');
  assert(found !== null && found !== undefined, 'Platform order transaction exists in DB');
  assertEq(found.category, 'platform_pending', 'Platform order category = platform_pending');
  assertEq(found.is_confirmed, 0, 'Platform order is NOT confirmed');
  assertEq(found.amount, 850, 'Platform order amount correct');
}

section('8.2 PlatformAccountant - logPlatformSettlement');

{
  // Add a couple pending orders first
  platformAcct.logPlatformOrder({ amount: 500, orderId: 'SWG-SETTLE-001', items: 'Thali', confidence: 0.90 }, 'Swiggy');
  platformAcct.logPlatformOrder({ amount: 700, orderId: 'SWG-SETTLE-002', items: 'Dosa', confidence: 0.90 }, 'Swiggy');

  // Settlement amount is less than total orders (commission deducted by platform)
  const result = platformAcct.logPlatformSettlement({ amount: 900, confidence: 0.95 }, 'Swiggy');

  assert(result.ordersReconciled >= 2, 'Settlement reconciled pending orders');
  assert(result.grossAmount >= 1200, 'Gross amount >= sum of orders');
  assertEq(result.netReceived, 900, 'Net received = settlement amount');
  assert(result.estimatedCommission >= 0, 'Implied commission is non-negative');
}

section('8.3 PlatformAccountant - commission calculation');

{
  // Add a single order, then settle for less
  platformAcct.logPlatformOrder({ amount: 1000, orderId: 'ZMT-COMM-001', items: 'Pizza', confidence: 0.90 }, 'Zomato');
  const result = platformAcct.logPlatformSettlement({ amount: 800, confidence: 0.95 }, 'Zomato');

  // Commission = gross - net
  assertEq(result.estimatedCommission, result.grossAmount - 800, 'Commission = gross - net');
}

section('8.4 PlatformAccountant - getPlatformSummary');

{
  const summary = platformAcct.getPlatformSummary('Swiggy', 30);
  assert(typeof summary.pending === 'number', 'Summary has pending field');
  assert(typeof summary.settled === 'number', 'Summary has settled field');
  assert(typeof summary.commission === 'number', 'Summary has commission field');
  assert(typeof summary.returns === 'number', 'Summary has returns field');
  assert(typeof summary.netReceived === 'number', 'Summary has netReceived field');
  assertEq(summary.netReceived, summary.settled - summary.commission - summary.returns, 'netReceived formula');
}

section('8.5 PLATFORM_COMMISSION_RATES');

assert(PLATFORM_COMMISSION_RATES['Swiggy'] !== undefined, 'Swiggy commission rates defined');
assert(PLATFORM_COMMISSION_RATES['Zomato'] !== undefined, 'Zomato commission rates defined');
assert(PLATFORM_COMMISSION_RATES['Amazon'] !== undefined, 'Amazon commission rates defined');
assert(PLATFORM_COMMISSION_RATES['Flipkart'] !== undefined, 'Flipkart commission rates defined');
assertEq(PLATFORM_COMMISSION_RATES['Swiggy'].default, 0.22, 'Swiggy default commission = 22%');

// ═══════════════════════════════════════════════════════════════════
// 9. channel-health.js
// ═══════════════════════════════════════════════════════════════════

const { ChannelHealth, HEALTH_ALERTS } = require('./channel-health');

section('9.1 ChannelHealth - checkHealth returns array');

const health = new ChannelHealth(db);

{
  const issues = health.checkHealth();
  assert(Array.isArray(issues), 'checkHealth returns an array');
  // We have recent transactions (from earlier tests), so some channels should be healthy
  for (const issue of issues) {
    assert(typeof issue.channel === 'string', 'Issue has channel field');
    assert(typeof issue.severity === 'string', 'Issue has severity field');
    assert(typeof issue.message === 'string', 'Issue has message field');
    assert(typeof issue.suggestion === 'string', 'Issue has suggestion field');
  }
}

section('9.2 ChannelHealth - getHealthAlert in different languages');

{
  const alertEn = health.getHealthAlert('check_dnd_settings', 'en', { hours: 36 });
  assert(alertEn !== null, 'English DND alert not null');
  assert(alertEn.includes('36'), 'English alert has hours');
  assert(alertEn.includes('SMS'), 'English alert mentions SMS');
}

{
  const alertHi = health.getHealthAlert('check_dnd_settings', 'hi', { hours: 48 });
  assert(alertHi !== null, 'Hindi DND alert not null');
  assert(alertHi.includes('48'), 'Hindi alert has hours');
}

{
  const alertTe = health.getHealthAlert('check_notification_permissions', 'te', {});
  assert(alertTe !== null, 'Telugu notification permission alert not null');
  assert(alertTe.includes('Termux'), 'Telugu alert mentions Termux');
}

{
  const alertCapture = health.getHealthAlert('increase_manual_logging', 'en', { pct: 65 });
  assert(alertCapture !== null, 'Capture rate alert not null');
  assert(alertCapture.includes('65'), 'Capture alert has percentage');
}

{
  const alertNull = health.getHealthAlert('nonexistent_alert', 'en', {});
  assertEq(alertNull, null, 'Unknown alert key returns null');
}

section('9.3 ChannelHealth - generateHealthReport');

{
  const issues = health.generateHealthReport();
  assert(Array.isArray(issues), 'generateHealthReport returns array');
  // If issues found, they should have been stored as brain observation
  // We don't necessarily need issues to pass; just verify the method works
}

section('9.4 ChannelHealth - hoursSince');

{
  assertEq(health.hoursSince(null), Infinity, 'hoursSince(null) = Infinity');
  assertEq(health.hoursSince(undefined), Infinity, 'hoursSince(undefined) = Infinity');

  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const hours = health.hoursSince(oneHourAgo);
  assertApprox(hours, 1.0, 0.1, 'hoursSince 1 hour ago ~ 1.0');
}

section('9.5 ChannelHealth - SMS freshness check logic');

{
  // We have recent SMS transactions (source='sms') from earlier tests.
  // The channel-health should NOT flag SMS as silent.
  const issues = health.checkHealth();
  const smsIssue = issues.find(i => i.channel === 'sms');
  // We added SMS-sourced transactions within this test run, so SMS should be fresh
  assertEq(smsIssue, undefined, 'No SMS freshness warning when recent SMS transactions exist');
}

section('9.6 HEALTH_ALERTS structure');

assert(typeof HEALTH_ALERTS.check_dnd_settings === 'object', 'DND settings alert group exists');
assert(typeof HEALTH_ALERTS.check_notification_permissions === 'object', 'Notification permissions alert group exists');
assert(typeof HEALTH_ALERTS.verify_both_channels_active === 'object', 'Both channels alert group exists');
assert(typeof HEALTH_ALERTS.increase_manual_logging === 'object', 'Manual logging alert group exists');

// Verify all alert groups have all 11 languages
for (const [key, group] of Object.entries(HEALTH_ALERTS)) {
  for (const lang of ['en', 'hi', 'te', 'ta', 'kn', 'bn', 'gu', 'mr', 'ml', 'or', 'pa']) {
    assert(typeof group[lang] === 'string', `HEALTH_ALERTS.${key} has ${lang} translation`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 10. bulk-import.js
// ═══════════════════════════════════════════════════════════════════

const { BulkImporter } = require('./bulk-import');

section('10.1 BulkImporter - parseCSV');

const bulkImporter = new BulkImporter(db);

{
  const csv = `Date,Description,Debit,Credit,Balance
15/02/2026,UPI/RAJAN/Ref123456,5000,,45000
16/02/2026,NEFT from KUMAR,,10000,55000
17/02/2026,ATM Withdrawal,2000,,53000`;

  const txns = bulkImporter.parseCSV(csv);
  assertEq(txns.length, 3, 'CSV parses 3 rows');

  assertEq(txns[0].type, 'debit', 'CSV row 1 = debit');
  assertEq(txns[0].amount, 5000, 'CSV row 1 amount');
  assertEq(txns[0].transaction_date, '2026-02-15', 'CSV row 1 date');
  assertEq(txns[0].method, 'UPI', 'CSV row 1 method = UPI');

  assertEq(txns[1].type, 'credit', 'CSV row 2 = credit');
  assertEq(txns[1].amount, 10000, 'CSV row 2 amount');
  assertEq(txns[1].method, 'NEFT', 'CSV row 2 method = NEFT');

  assertEq(txns[2].type, 'debit', 'CSV row 3 = debit');
  assertEq(txns[2].amount, 2000, 'CSV row 3 amount');
  assertEq(txns[2].method, 'ATM', 'CSV row 3 method = ATM');
}

{
  const csv = `Date,Amount,Type,Reference
01/01/2026,-1500,debit,REF001
02/01/2026,3000,credit,REF002`;

  const txns = bulkImporter.parseCSV(csv);
  assertEq(txns.length, 2, 'CSV with amount+type parses 2 rows');
  assertEq(txns[0].type, 'debit', 'Negative amount = debit');
  assertEq(txns[0].amount, 1500, 'Negative amount absolute value');
  assertEq(txns[1].type, 'credit', 'Type column credit');
}

{
  const txns = bulkImporter.parseCSV(null);
  assertEq(txns.length, 0, 'parseCSV null returns empty');

  const txns2 = bulkImporter.parseCSV('');
  assertEq(txns2.length, 0, 'parseCSV empty returns empty');
}

section('10.2 BulkImporter - parsePassbookRows');

{
  const ocrText = `
15/02/2026  UPI/RAJAN/Ref123456         5,000           45,000
16/02/2026  NEFT DEPOSIT CR                    10,000    55,000
17/02/2026  ATM WDL                      2,000           53,000
`;
  const txns = bulkImporter.parsePassbookRows(ocrText);
  assert(txns.length >= 2, `Passbook parsed ${txns.length} rows (>= 2)`);
  // Verify dates are parsed correctly
  const firstTxn = txns[0];
  assertEq(firstTxn.transaction_date, '2026-02-15', 'Passbook date parsed correctly');
  assert(firstTxn.amount > 0, 'Passbook amount > 0');
}

{
  const txns = bulkImporter.parsePassbookRows(null);
  assertEq(txns.length, 0, 'parsePassbookRows null returns empty');

  const txns2 = bulkImporter.parsePassbookRows('No dates here, just text.');
  assertEq(txns2.length, 0, 'parsePassbookRows no-date text returns empty');
}

section('10.3 BulkImporter - importBatch and dedup within batch');

{
  // Import a batch of transactions
  const batchTxns = [
    { type: 'credit', amount: 5555, counterparty_name: 'Batch Test A', method: 'UPI', reference_id: 'BATCH_REF_001', transaction_date: '2026-02-15' },
    { type: 'debit', amount: 3333, counterparty_name: 'Batch Test B', method: 'CASH', reference_id: null, transaction_date: '2026-02-15' },
  ];

  const result = bulkImporter.importBatch(batchTxns, 'csv_export', 'en');
  assertEq(result.total, 2, 'Batch total = 2');
  assertEq(result.imported, 2, 'Batch imported = 2');
  assertEq(result.duplicates, 0, 'Batch duplicates = 0');
  assert(typeof result.batchId === 'string', 'Batch has batchId');
}

{
  // Import again with some overlapping data — should detect duplicates
  const batchTxns2 = [
    { type: 'credit', amount: 5555, counterparty_name: 'Batch Test A', method: 'UPI', reference_id: 'BATCH_REF_001', transaction_date: '2026-02-15' },
    { type: 'credit', amount: 7777, counterparty_name: 'Batch Test C', method: 'UPI', reference_id: 'BATCH_REF_NEW', transaction_date: '2026-02-16' },
  ];

  const result2 = bulkImporter.importBatch(batchTxns2, 'csv_export', 'en');
  assertEq(result2.total, 2, 'Batch 2 total = 2');
  assertEq(result2.duplicates, 1, 'Batch 2 detects 1 duplicate (BATCH_REF_001)');
  assertEq(result2.imported, 1, 'Batch 2 imports only 1 new');
}

section('10.4 BulkImporter - getConfidence');

assertEq(bulkImporter.getConfidence('csv_export'), 0.95, 'CSV confidence = 0.95');
assertEq(bulkImporter.getConfidence('pdf_statement'), 0.90, 'PDF confidence = 0.90');
assertEq(bulkImporter.getConfidence('app_screenshot'), 0.80, 'Screenshot confidence = 0.80');
assertEq(bulkImporter.getConfidence('passbook_photo'), 0.75, 'Passbook confidence = 0.75');
assertEq(bulkImporter.getConfidence('unknown_type'), 0.70, 'Unknown type defaults to 0.70');

section('10.5 BulkImporter - getImportMessage');

{
  const msg = bulkImporter.getImportMessage({
    imported: 10, duplicates: 2, documentType: 'csv_export'
  }, 'en');
  assert(msg.includes('10'), 'Import message has imported count');
  assert(msg.includes('2'), 'Import message has duplicate count');
  assert(msg.includes('CSV export'), 'Import message has document type');
}

{
  const msg = bulkImporter.getImportMessage({
    imported: 5, duplicates: 1, documentType: 'passbook_photo'
  }, 'hi');
  assert(msg.includes('5'), 'Hindi import message has count');
}

section('10.6 BulkImporter - CSV with quoted fields');

{
  const csv = `Date,Description,Amount,Type
"15/02/2026","Payment to RAJAN, for goods","-5000","debit"
"16/02/2026","Received from SHARMA",3000,credit`;

  const txns = bulkImporter.parseCSV(csv);
  assertEq(txns.length, 2, 'CSV with quoted fields parses correctly');
  assert(txns[0].description.includes('RAJAN'), 'Quoted field preserves commas');
}

section('10.7 BulkImporter - batch dedup by same-day amount+type');

{
  // First insert a transaction manually
  db.addTransaction({
    type: 'credit', amount: 12345, counterparty_name: 'Manual Entry',
    method: 'CASH', source: 'manual', transaction_date: '2026-02-19'
  });

  // Now try to import a batch with the same amount+date+type
  const batchTxns = [
    { type: 'credit', amount: 12345, counterparty_name: 'Duplicate', method: 'CASH', transaction_date: '2026-02-19' },
    { type: 'debit', amount: 999, counterparty_name: 'New Entry', method: 'CASH', transaction_date: '2026-02-19' },
  ];

  const result = bulkImporter.importBatch(batchTxns, 'passbook_photo', 'en');
  assertEq(result.duplicates, 1, 'Same-day dedup catches existing DB entry');
  assertEq(result.imported, 1, 'Only new entry imported');
}

// ═══════════════════════════════════════════════════════════════════
// Done!
// ═══════════════════════════════════════════════════════════════════

} catch (e) {
  console.error('\nUNEXPECTED ERROR:', e.stack || e);
  failed++;
} finally {
  if (db) db.close();
  // Cleanup
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`========================================`);
process.exit(failed > 0 ? 1 : 0);
