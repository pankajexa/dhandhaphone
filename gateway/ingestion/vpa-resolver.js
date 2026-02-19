// VPA-to-Contact Resolution for DhandhaPhone
// Resolves UPI VPAs (e.g. rajan@ybl, sharma_store@paytm) to known contacts
// Uses vpa_map cache, phone lookup, and fuzzy name matching

'use strict';

class VPAResolver {
  /**
   * @param {object} db - DhandhaDB instance with .db (raw better-sqlite3),
   *                       .resolveVPA(vpa), .saveVPAMapping(vpa, contactId, contactName)
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Resolve a UPI VPA to a known contact.
   *
   * Step 1: Check vpa_map table via db.resolveVPA()
   * Step 2: If local part is a 10-digit phone, search contacts by phone
   * Step 3: Fuzzy name match against contacts.name_normalized
   * Step 4: Return null if ambiguous or no match
   *
   * @param {string} vpa - UPI VPA string (e.g. "rajan@ybl")
   * @returns {{ contact_id: number, contact_name: string } | null}
   */
  resolve(vpa) {
    if (!vpa) return null;

    // Step 1: Check known VPA mappings
    const known = this.db.resolveVPA(vpa);
    if (known) {
      return { contact_id: known.contact_id, contact_name: known.contact_name };
    }

    // Split VPA into local part and domain
    const atIndex = vpa.indexOf('@');
    if (atIndex === -1) return null;
    const local = vpa.substring(0, atIndex);

    // Step 2: Phone number VPA (e.g. 9876543210@upi)
    if (/^\d{10}$/.test(local)) {
      const contact = this.db.db.prepare(`
        SELECT id, name FROM contacts
        WHERE phone LIKE ? AND is_deleted = 0
      `).get(`%${local}`);

      if (contact) {
        this.db.saveVPAMapping(vpa, contact.id, contact.name);
        return { contact_id: contact.id, contact_name: contact.name };
      }
    }

    // Step 3: Name-based VPA (e.g. sharma_traders@paytm -> "sharma traders")
    const nameGuess = local.replace(/[_.\-]/g, ' ').toLowerCase();
    const candidates = this.db.db.prepare(`
      SELECT id, name FROM contacts
      WHERE name_normalized LIKE ? AND is_deleted = 0
    `).all(`%${nameGuess}%`);

    if (candidates.length === 1) {
      // Unambiguous match - save mapping for future lookups
      this.db.saveVPAMapping(vpa, candidates[0].id, candidates[0].name);
      return { contact_id: candidates[0].id, contact_name: candidates[0].name };
    }

    // Step 4: Ambiguous or no match
    // Agent will ask owner to confirm on next interaction
    return null;
  }

  /**
   * Extract a VPA from notification/SMS text.
   *
   * @param {string} text - Raw notification or SMS text
   * @returns {string|null} The extracted VPA or null
   */
  extractVPA(text) {
    if (!text) return null;
    const match = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z]+)/);
    return match ? match[1] : null;
  }
}

module.exports = { VPAResolver };
