#!/usr/bin/env node
// Test SMS parser against real Indian bank message formats

const { parseBankSMS } = require('./sms-parser');

const testCases = [
  // HDFC Credit
  {
    sms: { _id: 1, address: "HDFCBK", body: "Rs.5000.00 credited to a/c XX1234 on 17-02-26 by UPI ref 423567890. Avl bal: Rs.47200.00", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "HDFC", method: "UPI", acct_last4: "1234" }
  },
  // HDFC Debit
  {
    sms: { _id: 2, address: "HDFCBK", body: "Rs.12000.00 debited from a/c XX1234 on 17-02-26. UPI txn Ref 987654321. Avl bal: Rs.35200.00", date: "2026-02-17 14:00:00" },
    expect: { type: "debit", amount: 12000, bank: "HDFC", method: "UPI" }
  },
  // SBI Credit
  {
    sms: { _id: 3, address: "SBIINB", body: "Dear Customer, your a/c no. XX5678 is credited by Rs.5,000.00 on 17Feb26 transfer from SHARMA (UPI Ref No 423567890). -SBI", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "SBI", counterparty: "SHARMA" }
  },
  // ICICI Credit
  {
    sms: { _id: 4, address: "ICICIB", body: "ICICI Bank Acct XX9012 credited with Rs 5,000.00 on 17-Feb-26; UPI: 423567890 from SHARMA. Avl Bal Rs 47,200.00", date: "2026-02-17 10:30:00" },
    expect: { type: "credit", amount: 5000, bank: "ICICI", counterparty: "SHARMA" }
  },
  // Axis Debit
  {
    sms: { _id: 5, address: "AxisBk", body: "Rs 8,500.00 debited from A/c no. XX3456 on 17-02-2026 through UPI-555555555. Bal: Rs 25,000.00", date: "2026-02-17 16:00:00" },
    expect: { type: "debit", amount: 8500, bank: "AXIS", method: "UPI" }
  },
  // NEFT transfer
  {
    sms: { _id: 6, address: "HDFCBK", body: "INR 25,000.00 credited to HDFC Bank A/c XX1234 on 17-02-2026 by a NEFT transfer from GUPTA SUPPLIERS. Avl bal: INR 72,200.00", date: "2026-02-17 11:00:00" },
    expect: { type: "credit", amount: 25000, bank: "HDFC", method: "NEFT", counterparty: "GUPTA SUPPLIERS" }
  },
  // OTP -- should return null
  {
    sms: { _id: 7, address: "HDFCBK", body: "Your OTP for transaction is 456789. Valid for 3 minutes. Do not share. -HDFC Bank", date: "2026-02-17 10:35:00" },
    expect: null
  },
  // Promotional -- should return null
  {
    sms: { _id: 8, address: "HDFCBK", body: "Get 10% cashback on credit card spends above Rs.5000. Offer valid till 28 Feb. T&C apply.", date: "2026-02-17 09:00:00" },
    expect: null
  },
  // Kotak Credit
  {
    sms: { _id: 9, address: "KOTAKB", body: "Rs 3500.00 is credited in your Kotak Bank A/c XX7890 on 17/02/2026 by NEFT from PATEL HARDWARE. Updated Bal:Rs 28500.00", date: "2026-02-17 15:00:00" },
    expect: { type: "credit", amount: 3500, bank: "KOTAK", method: "NEFT" }
  },
  // Rupee symbol format
  {
    sms: { _id: 10, address: "SBIINB", body: "₹15,000 received in XX5678 from MEHTA via UPI Ref 111222333", date: "2026-02-17 12:00:00" },
    expect: { type: "credit", amount: 15000, bank: "SBI", method: "UPI" }
  },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = parseBankSMS(tc.sms);

  if (tc.expect === null) {
    if (result === null) {
      passed++;
      console.log(`  SMS #${tc.sms._id}: Correctly ignored`);
    } else {
      failed++;
      console.log(`X SMS #${tc.sms._id}: Should be null but got:`, result);
    }
    continue;
  }

  if (result === null) {
    failed++;
    console.log(`X SMS #${tc.sms._id}: Returned null, expected:`, tc.expect);
    continue;
  }

  let ok = true;
  for (const [key, val] of Object.entries(tc.expect)) {
    if (result[key] !== val) {
      ok = false;
      console.log(`X SMS #${tc.sms._id}: ${key} = "${result[key]}", expected "${val}"`);
    }
  }
  if (ok) {
    passed++;
    console.log(`  SMS #${tc.sms._id}: ${result.type} Rs.${result.amount} ${result.bank} ${result.counterparty || ''}`);
  } else {
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} tests passed.`);
process.exit(failed > 0 ? 1 : 0);
