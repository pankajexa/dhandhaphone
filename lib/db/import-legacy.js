#!/usr/bin/env node
// Imports all existing flat-file data into SQLite
// Idempotent: checks if data exists before importing
// Run: DHANDHA_WORKSPACE=. node lib/db/import-legacy.js

const path = require('path');
const fs = require('fs');
const libDir = path.join(__dirname, '..');
const { PATHS, readJSON, readJSONL, getDB } = require(path.join(libDir, 'utils'));

function importLegacy() {
  const db = getDB();
  const stats = { contacts: 0, transactions: 0, inventory: 0, prices: 0,
                  reminders: 0, actions: 0, documents: 0, categories: 0,
                  fraudAlerts: 0, anonMappings: 0 };

  // Check if data already exists (idempotency)
  const existing = db.getTransactions({ limit: 1 });
  if (existing.length > 0) {
    console.log('[Import] DB already has data. Skipping import.');
    console.log('[Import] To re-import, delete dhandhaphone.db first.');
    return stats;
  }

  console.log('[Import] Starting legacy data import...');

  // --- 1. Contacts ---
  const contactData = readJSON(PATHS.contacts);
  const contactIdMap = {}; // maps old ID (C-001) -> new integer ID

  if (contactData && contactData.contacts && contactData.contacts.length > 0) {
    for (const c of contactData.contacts) {
      const newId = db.addContact({
        name: c.name,
        phone: c.phone || null,
        email: c.email || null,
        address: c.address || null,
        company: c.company || null,
        type: c.type || 'customer',
        gstin: c.gstin || null,
        notes: c.notes || null,
        balance: c.balance || 0,
        tags: c.tags ? (Array.isArray(c.tags) ? c.tags.join(',') : c.tags) : null,
      });
      if (c.id) contactIdMap[c.id] = newId;
      stats.contacts++;
    }
    console.log(`[Import] ${stats.contacts} contacts imported`);
  }

  // --- 2. Transactions from monthly ledger files ---
  const ledgerDir = path.join(PATHS.workspace, 'ledger');
  if (fs.existsSync(ledgerDir)) {
    const ledgerFiles = fs.readdirSync(ledgerDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort();

    for (const file of ledgerFiles) {
      const txns = readJSONL(path.join(ledgerDir, file));
      for (const t of txns) {
        // Resolve counterparty to contact ID if possible
        let counterpartyId = null;
        if (t.counterparty) {
          const matches = db.findContact(t.counterparty);
          if (matches.length > 0) counterpartyId = matches[0].id;
        }

        const txnDate = t.ts ? t.ts.split('T')[0] : (t.date || new Date().toISOString().split('T')[0]);

        db.addTransaction({
          type: t.type,
          amount: t.amount,
          counterparty_id: counterpartyId,
          counterparty_name: t.counterparty || null,
          method: t.method || 'OTHER',
          source: t.source || 'sms',
          category: t.category || null,
          description: t.notes || t.description || null,
          reference_id: t.ref || null,
          original_message: t.raw || null,
          confidence: t.confidence || 1.0,
          transaction_date: txnDate,
        });

        // Mark as processed for dedup
        if (t.ref) {
          db.markProcessed(t.amount, txnDate, t.ref, t.source || 'sms', null);
        }

        stats.transactions++;
      }
    }
    console.log(`[Import] ${stats.transactions} transactions imported`);
  }

  // --- 3. Inventory + margins merge ---
  const invData = readJSON(PATHS.inventory);
  const marginData = readJSON(PATHS.margins);
  const marginMap = {};
  if (marginData && marginData.items) {
    for (const m of marginData.items) {
      marginMap[(m.name || '').toLowerCase()] = m;
    }
  }

  if (invData && invData.items && invData.items.length > 0) {
    for (const item of invData.items) {
      const margins = marginMap[(item.name || '').toLowerCase()] || {};
      db.addInventoryItem({
        name: item.name,
        sku: item.sku || null,
        category: item.category || null,
        unit: item.unit || null,
        quantity: item.quantity || 0,
        min_quantity: item.reorder_point || item.min_quantity || null,
        purchase_price: margins.purchase_price || item.purchase_price || null,
        selling_price: margins.selling_price || item.selling_price || null,
        supplier_id: item.supplier_id ? (contactIdMap[item.supplier_id] || null) : null,
      });
      stats.inventory++;
    }
    console.log(`[Import] ${stats.inventory} inventory items imported`);
  }

  // --- 4. Price history ---
  const prices = readJSONL(PATHS.priceHistory);
  if (prices.length > 0) {
    for (const p of prices) {
      db.addPriceEntry({
        item_name: p.item || p.item_name || 'Unknown',
        price: p.price,
        unit: p.unit || null,
        source: p.source || 'manual',
        supplier_id: p.supplier_id ? (contactIdMap[p.supplier_id] || null) : null,
      });
      stats.prices++;
    }
    console.log(`[Import] ${stats.prices} price entries imported`);
  }

  // --- 5. Pending actions ---
  const pendingData = readJSON(PATHS.pending);
  if (pendingData && pendingData.actions && pendingData.actions.length > 0) {
    for (const a of pendingData.actions) {
      db.addPendingAction({
        type: a.type || 'general',
        target_contact_id: a.target_contact_id ? (contactIdMap[a.target_contact_id] || null) : null,
        description: a.description || a.notes || null,
        due_date: a.due_date || null,
        data: a,
      });
      stats.actions++;
    }
    console.log(`[Import] ${stats.actions} pending actions imported`);
  }

  // --- 6. Reminders ---
  const reminders = readJSONL(PATHS.reminders);
  if (reminders.length > 0) {
    for (const r of reminders) {
      const contactId = r.contact_id ? (contactIdMap[r.contact_id] || null) : null;
      if (!contactId) continue; // skip orphaned reminders
      db.addReminder({
        contact_id: contactId,
        amount: r.amount || null,
        message_draft: r.message || r.message_draft || null,
        scheduled_at: r.scheduled_at || r.date || null,
        channel: r.channel || 'sms',
      });
      stats.reminders++;
    }
    console.log(`[Import] ${stats.reminders} reminders imported`);
  }

  // --- 7. Category rules ---
  const catData = readJSON(PATHS.categories);
  if (catData) {
    // categories.json has { income: [...], expense: [...] } with keyword rules
    for (const [group, rules] of Object.entries(catData)) {
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        if (typeof rule === 'string') {
          db.addCategoryRule({
            category: rule,
            match_type: 'keyword',
            match_value: rule,
          });
          stats.categories++;
        } else if (rule && rule.category) {
          db.addCategoryRule({
            category: rule.category,
            match_type: rule.match_type || 'keyword',
            match_value: rule.match_value || rule.keyword || rule.category,
            priority: rule.priority || 0,
          });
          stats.categories++;
        }
      }
    }
    console.log(`[Import] ${stats.categories} category rules imported`);
  }

  // --- 8. GST Profile -> owner_profile ---
  const gstData = readJSON(PATHS.gstProfile);
  if (gstData) {
    db.setProfile('gst_profile', gstData);
    console.log('[Import] GST profile imported');
  }

  // --- 9. Fraud baselines ---
  const baselineData = readJSON(PATHS.txnBaseline);
  if (baselineData) {
    for (const [key, value] of Object.entries(baselineData)) {
      db.setBaseline(key, value);
    }
    console.log('[Import] Fraud baselines imported');
  }

  // --- 10. Fraud alerts ---
  const fraudAlerts = readJSONL(PATHS.fraudAlerts);
  if (fraudAlerts.length > 0) {
    for (const a of fraudAlerts) {
      db.addFraudAlert({
        alert_type: a.type || a.alert_type || 'unknown',
        severity: a.severity || 'info',
        description: a.description || a.message || null,
        data: a,
      });
      stats.fraudAlerts++;
    }
    console.log(`[Import] ${stats.fraudAlerts} fraud alerts imported`);
  }

  // --- 11. Documents ---
  const docs = readJSONL(PATHS.documents);
  if (docs.length > 0) {
    for (const d of docs) {
      db.addDocument({
        type: d.type || 'unknown',
        file_path: d.file_path || d.path || null,
        raw_text: d.raw_text || d.text || null,
        structured_data: d.structured_data || d.data || null,
        language: d.language || null,
        confidence: d.confidence || null,
      });
      stats.documents++;
    }
    console.log(`[Import] ${stats.documents} documents imported`);
  }

  // --- 12. SMS state ---
  try {
    const lastSmsId = fs.readFileSync(PATHS.lastSmsId, 'utf8').trim();
    if (lastSmsId) db.setSmsState('last_sms_id', parseInt(lastSmsId) || 0);
  } catch {}
  try {
    const lastNotifId = fs.readFileSync(PATHS.lastNotificationId, 'utf8').trim();
    if (lastNotifId) db.setSmsState('last_notification_id', parseInt(lastNotifId) || 0);
  } catch {}

  // --- 13. Anon map ---
  const anonData = readJSON(PATHS.anonMap);
  if (anonData) {
    if (anonData.people) {
      for (const [name, id] of Object.entries(anonData.people)) {
        db.setAnonMapping('people', name, id);
        stats.anonMappings++;
      }
    }
    if (anonData.phones) {
      for (const [phone, id] of Object.entries(anonData.phones)) {
        db.setAnonMapping('phones', phone, id);
        stats.anonMappings++;
      }
    }
    if (anonData.accounts) {
      for (const [acct, id] of Object.entries(anonData.accounts)) {
        db.setAnonMapping('accounts', acct, id);
        stats.anonMappings++;
      }
    }
    if (stats.anonMappings > 0) {
      console.log(`[Import] ${stats.anonMappings} anon mappings imported`);
    }
  }

  console.log('[Import] Legacy import complete!');
  console.log('[Import] Stats:', JSON.stringify(stats));
  return stats;
}

if (require.main === module) {
  importLegacy();
}

module.exports = { importLegacy };
