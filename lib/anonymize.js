// PII Anonymization/De-anonymization for LLM calls
// Strips names, phones, accounts before sending to cloud
// Restores them after receiving LLM response

const path = require('path');
const { PATHS, readJSON, writeJSON } = require(path.join(__dirname, 'utils'));

function loadAnonMap() {
  return readJSON(PATHS.anonMap) || {
    people: {}, phones: {}, accounts: {}, reverse_people: {}
  };
}

function saveAnonMap(map) {
  writeJSON(PATHS.anonMap, map);
}

function anonymize(text) {
  const map = loadAnonMap();
  let result = text;

  // Load known contacts for name matching
  const contactData = readJSON(PATHS.contacts);
  const contacts = contactData ? contactData.contacts : [];

  // 1. Replace known contact names with their IDs
  // Sort by name length (longest first) to avoid partial matches
  const sortedContacts = [...contacts].sort(
    (a, b) => b.name.length - a.name.length
  );

  for (const contact of sortedContacts) {
    if (!contact.name || contact.name.length < 2) continue;
    const escaped = contact.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    if (regex.test(result)) {
      map.people[contact.name] = contact.id;
      map.reverse_people[contact.id] = contact.name;
      result = result.replace(new RegExp(escaped, 'gi'), contact.id);
    }
  }

  // 2. Replace phone numbers (+91XXXXXXXXXX or 10-digit)
  result = result.replace(/(\+91[-\s]?\d{10}|\b[6-9]\d{9}\b)/g, (match) => {
    if (!map.phones[match]) {
      map.phones[match] = `PHONE-${String(
        Object.keys(map.phones).length + 1
      ).padStart(3, '0')}`;
    }
    return map.phones[match];
  });

  // 3. Replace bank account fragments
  result = result.replace(
    /(?:a\/c|acct?|account)\s*(?:no\.?\s*)?([X*]*\d{4,})/gi,
    'A/c REDACTED'
  );

  // 4. Replace UPI IDs (name@bank format)
  result = result.replace(/[\w.]+@[a-zA-Z]{2,}/g, 'UPI-REDACTED');

  saveAnonMap(map);
  return result;
}

function deanonymize(text) {
  const map = loadAnonMap();
  let result = text;

  // Replace contact IDs back with names
  for (const [id, name] of Object.entries(map.reverse_people)) {
    const regex = new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, name);
  }

  return result;
}

// If run directly, test with stdin
if (require.main === module) {
  const input = process.argv[2] || 'Sharma ji ka phone 9876543210, a/c XX1234, UPI sharma@hdfc';
  console.log('Input:', input);
  console.log('Anonymized:', anonymize(input));
  console.log('De-anonymized:', deanonymize(anonymize(input)));
}

module.exports = { anonymize, deanonymize };
