// Multi-language response templates for common DhandhaPhone operations
// The agent uses these for brief, consistent confirmations.

const TEMPLATES = {
  txn_confirmed: {
    en: '{{name}} — ₹{{amount}} {{type}}. Logged.',
    hi: '{{name}} — ₹{{amount}} {{type}}. Entry ho gayi.',
    ta: '{{name}} — ₹{{amount}} {{type}}. Pathivu aagividdu.',
    te: '{{name}} — ₹{{amount}} {{type}}. Entry ayyindi.',
    kn: '{{name}} — ₹{{amount}} {{type}}. Entry aagide.',
    ml: '{{name}} — ₹{{amount}} {{type}}. Entry aayi.',
    bn: '{{name}} — ₹{{amount}} {{type}}. Entry hoyeche.',
    mr: '{{name}} — ₹{{amount}} {{type}}. Entry zali.',
    gu: '{{name}} — ₹{{amount}} {{type}}. Entry thai gayi.',
    pa: '{{name}} — ₹{{amount}} {{type}}. Entry ho gayi.',
    or: '{{name}} — ₹{{amount}} {{type}}. Entry heigala.',
  },
  balance_update: {
    en: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    hi: '{{name}} ka balance: ₹{{balance}} ({{direction}}).',
    ta: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    te: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    kn: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    ml: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    bn: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    mr: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    gu: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    pa: '{{name}} balance: ₹{{balance}} ({{direction}}).',
    or: '{{name}} balance: ₹{{balance}} ({{direction}}).',
  },
  stock_update: {
    en: '{{item}} — {{quantity}} {{unit}} left.',
    hi: '{{item}} — {{quantity}} {{unit}} bache hain.',
    ta: '{{item}} — {{quantity}} {{unit}} irukkudhu.',
    te: '{{item}} — {{quantity}} {{unit}} unnaayi.',
    kn: '{{item}} — {{quantity}} {{unit}} ide.',
    ml: '{{item}} — {{quantity}} {{unit}} undu.',
    bn: '{{item}} — {{quantity}} {{unit}} ache.',
    mr: '{{item}} — {{quantity}} {{unit}} aahet.',
    gu: '{{item}} — {{quantity}} {{unit}} che.',
    pa: '{{item}} — {{quantity}} {{unit}} bache ne.',
    or: '{{item}} — {{quantity}} {{unit}} achhi.',
  },
  reminder_sent: {
    en: 'Reminder sent to {{name}} for ₹{{amount}}.',
    hi: '{{name}} ko ₹{{amount}} ka reminder bhej diya.',
    ta: '{{name}}-ku ₹{{amount}} reminder anuppivittom.',
    te: '{{name}}-ki ₹{{amount}} reminder pampinchamu.',
    kn: '{{name}}-ge ₹{{amount}} reminder kaluhisidhe.',
    ml: '{{name}}-inu ₹{{amount}} reminder ayachu.',
    bn: '{{name}}-ke ₹{{amount}} reminder pathano hoyeche.',
    mr: '{{name}}-la ₹{{amount}} reminder pathavla.',
    gu: '{{name}}-ne ₹{{amount}} reminder moklyo.',
    pa: '{{name}} nu ₹{{amount}} da reminder bhejiaa.',
    or: '{{name}}-nku ₹{{amount}} reminder pathaa gala.',
  },
  config_changed: {
    en: 'Done — {{setting}}: {{old_value}} → {{new_value}}.',
    hi: 'Done — {{setting}}: {{old_value}} → {{new_value}}.',
    ta: 'Mudinthadhu — {{setting}}: {{old_value}} → {{new_value}}.',
    te: 'Ayyindhi — {{setting}}: {{old_value}} → {{new_value}}.',
    kn: 'Aayithu — {{setting}}: {{old_value}} → {{new_value}}.',
    ml: 'Aayii — {{setting}}: {{old_value}} → {{new_value}}.',
    bn: 'Hoyeche — {{setting}}: {{old_value}} → {{new_value}}.',
    mr: 'Zale — {{setting}}: {{old_value}} → {{new_value}}.',
    gu: 'Thayu — {{setting}}: {{old_value}} → {{new_value}}.',
    pa: 'Ho gaya — {{setting}}: {{old_value}} → {{new_value}}.',
    or: 'Heigala — {{setting}}: {{old_value}} → {{new_value}}.',
  },
};

/**
 * Format a template with variables.
 * @param {string} templateName - Key from TEMPLATES
 * @param {string} lang - Language code (en, hi, ta, te, kn, ml, bn, mr, gu, pa, or)
 * @param {object} vars - Variables to substitute (e.g., { name: 'Sharma', amount: '5,000' })
 * @returns {string}
 */
function format(templateName, lang, vars = {}) {
  const template = TEMPLATES[templateName];
  if (!template) return `[Unknown template: ${templateName}]`;

  let str = template[lang] || template.en;

  for (const [key, value] of Object.entries(vars)) {
    // Use function replacement to avoid special $ interpretation in replacement strings
    str = str.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => String(value));
  }

  return str;
}

module.exports = { format, TEMPLATES };
