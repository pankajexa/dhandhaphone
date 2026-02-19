#!/usr/bin/env node
// Brain Graph Updater — Higher-level CRUD operations for the brain graph
// Both a class API and CLI entry point

const path = require('path');

// Auto-expiry defaults by observation type (in days)
const AUTO_EXPIRY = {
  anomaly: 7,
  mood: 2,
  insight: 90,
  prediction: 30,
  inference: 30,
  intention: null,  // never expires
  todo: null,       // never expires
};

class GraphUpdater {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create or merge an entity for a contact.
   * If entity already exists for this contact, merges properties.
   */
  upsertContactProfile(contactId, profileData) {
    const existing = this.db.findBrainEntityByRef('contacts', contactId);

    if (existing) {
      const merged = { ...existing.properties, ...profileData };
      this.db.updateBrainEntity(existing.id, {
        properties: merged,
        confidence: profileData.confidence || existing.confidence
      });
      return existing.id;
    }

    // Get contact name for the entity
    const contact = this.db.getContact(contactId);
    const name = contact ? contact.name : `Contact #${contactId}`;
    const type = (contact && contact.type === 'supplier')
      ? 'supplier_profile'
      : 'customer_profile';

    return this.db.addBrainEntity({
      type,
      name: `${name} Profile`,
      ref_id: contactId,
      ref_table: 'contacts',
      properties: profileData,
      confidence: profileData.confidence || 0.5
    });
  }

  /**
   * Create or merge an entity for an inventory item.
   */
  upsertProductInsight(inventoryId, insightData) {
    const existing = this.db.findBrainEntityByRef('inventory', inventoryId);

    if (existing) {
      const merged = { ...existing.properties, ...insightData };
      this.db.updateBrainEntity(existing.id, {
        properties: merged,
        confidence: insightData.confidence || existing.confidence
      });
      return existing.id;
    }

    const item = this.db.getInventoryItem(inventoryId);
    const name = item ? item.name : `Item #${inventoryId}`;

    return this.db.addBrainEntity({
      type: 'product_insight',
      name: `${name} Insight`,
      ref_id: inventoryId,
      ref_table: 'inventory',
      properties: insightData,
      confidence: insightData.confidence || 0.5
    });
  }

  /**
   * Create or update an edge between two entities.
   */
  upsertEdge(fromEntityId, toEntityId, edgeType, edgeData = {}) {
    // Separate weight from actual properties to avoid storing metadata in JSON
    const { weight, from, to, type: _type, ...props } = edgeData;
    const existing = this.db.findBrainEdge(fromEntityId, toEntityId, edgeType);

    if (existing) {
      const merged = { ...existing.properties, ...props };
      this.db.updateBrainEdge(existing.id, {
        weight: weight != null ? weight : existing.weight,
        properties: merged
      });
      return existing.id;
    }

    return this.db.addBrainEdge({
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      type: edgeType,
      weight: weight != null ? weight : 0.5,
      properties: props
    });
  }

  /**
   * Add an observation with auto-expiry based on type.
   */
  addObservation(obs) {
    let expiresAt = obs.expires_at || null;

    // Auto-set expiry if not provided
    if (!expiresAt && AUTO_EXPIRY[obs.type] != null) {
      const days = AUTO_EXPIRY[obs.type];
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString().replace('T', ' ').split('.')[0];
    }

    return this.db.addBrainObservation({
      ...obs,
      expires_at: expiresAt
    });
  }

  /**
   * Upsert the singleton business_snapshot entity.
   */
  updateBusinessSnapshot(snapshotData) {
    const snapshots = this.db.getBrainEntitiesByType('business_snapshot', { limit: 1 });

    if (snapshots.length > 0) {
      const merged = { ...snapshots[0].properties, ...snapshotData };
      this.db.updateBrainEntity(snapshots[0].id, { properties: merged });
      return snapshots[0].id;
    }

    return this.db.addBrainEntity({
      type: 'business_snapshot',
      name: 'Business Snapshot',
      properties: snapshotData,
      confidence: 1.0
    });
  }
}

// CLI entry point
if (require.main === module) {
  const { getDB } = require('../utils');
  const db = getDB();
  const updater = new GraphUpdater(db);

  const [,, command, jsonArg] = process.argv;

  if (!command || !jsonArg) {
    console.error('Usage: node graph-updater.js <command> <json>');
    console.error('Commands: upsert-contact-profile, upsert-product-insight, add-observation, upsert-edge, update-snapshot');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(jsonArg);
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  let result;
  switch (command) {
    case 'upsert-contact-profile':
      result = updater.upsertContactProfile(data.contactId, data.data || data);
      break;
    case 'upsert-product-insight':
      result = updater.upsertProductInsight(data.inventoryId, data.data || data);
      break;
    case 'add-observation':
      result = updater.addObservation(data);
      break;
    case 'upsert-edge':
      result = updater.upsertEdge(data.from, data.to, data.type, data);
      break;
    case 'update-snapshot':
      result = updater.updateBusinessSnapshot(data);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  console.log(JSON.stringify({ id: result }));
  db.close();
}

module.exports = { GraphUpdater };
