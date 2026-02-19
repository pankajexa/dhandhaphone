// gateway/ingestion/channel-health.js — Channel health monitor for DhandhaPhone
// Detects when data ingestion channels (SMS, notifications) go silent or degrade,
// and alerts the owner in their language with specific remediation steps.

'use strict';

/**
 * Multilingual health alerts for all 11 supported languages.
 * Each alert corresponds to a specific channel health issue.
 * Placeholders: {hours} = silent hours, {pct} = capture percentage.
 */
const HEALTH_ALERTS = {
  check_dnd_settings: {
    en: "I haven't received any bank SMS in {hours} hours. Check if DND is blocking messages \u2014 go to Settings > Messages > Block settings.",
    hi: "Mujhe {hours} ghante se koi bank SMS nahi mila. DND check karo \u2014 Settings > Messages > Block settings mein jaao.",
    te: "Naaku {hours} gantala nundi bank SMS raaledu. DND check cheyandi \u2014 Settings > Messages > Block settings lo choodandi.",
    ta: "Enakku {hours} mani neram-aa bank SMS varala. DND check pannunga \u2014 Settings > Messages > Block settings la parunga.",
    kn: "Nanage {hours} ghante inda bank SMS barilla. DND check maadi \u2014 Settings > Messages > Block settings alli noodi.",
    bn: "Amar {hours} ghonta dhore kono bank SMS asheni. DND check koren \u2014 Settings > Messages > Block settings e jaan.",
    gu: "Mane {hours} kalak thi koi bank SMS nathi aavyo. DND check karo \u2014 Settings > Messages > Block settings ma jao.",
    mr: "Mala {hours} taasanpasun kahi bank SMS aala nahi. DND check kara \u2014 Settings > Messages > Block settings madhe jaa.",
    ml: "Enikku {hours} manikkoore aayi bank SMS vannilla. DND check cheyyoo \u2014 Settings > Messages > Block settings il nokkoo.",
    or: "Mote {hours} ghanta hela kounasi bank SMS asini. DND check kara \u2014 Settings > Messages > Block settings re jaa.",
    pa: "Mainu {hours} ghante ton koi bank SMS nahi aaya. DND check karo \u2014 Settings > Messages > Block settings ch jao.",
  },

  check_notification_permissions: {
    en: "I'm not seeing payment app notifications. Check if Termux has notification access \u2014 Settings > Apps > Termux > Notifications.",
    hi: "Mujhe payment app notifications nahi dikh rahe. Termux ka notification access check karo \u2014 Settings > Apps > Termux > Notifications.",
    te: "Payment app notifications kanipinchhatledu. Termux notification access check cheyandi \u2014 Settings > Apps > Termux > Notifications.",
    ta: "Payment app notifications theriyala. Termux notification access check pannunga \u2014 Settings > Apps > Termux > Notifications.",
    kn: "Payment app notifications kanisthilla. Termux notification access check maadi \u2014 Settings > Apps > Termux > Notifications.",
    bn: "Payment app notifications dekhte pachchhi na. Termux notification access check koro \u2014 Settings > Apps > Termux > Notifications.",
    gu: "Payment app notifications dikhai nathi rahya. Termux notification access check karo \u2014 Settings > Apps > Termux > Notifications.",
    mr: "Payment app notifications disat nahit. Termux notification access check kara \u2014 Settings > Apps > Termux > Notifications.",
    ml: "Payment app notifications kaanunnilla. Termux notification access check cheyyoo \u2014 Settings > Apps > Termux > Notifications.",
    or: "Payment app notifications dekhaajauchhi nahin. Termux notification access check kara \u2014 Settings > Apps > Termux > Notifications.",
    pa: "Payment app notifications nahi dikh rahe. Termux notification access check karo \u2014 Settings > Apps > Termux > Notifications.",
  },

  verify_both_channels_active: {
    en: "SMS and notification channels aren't overlapping. Both should be active for reliable data capture.",
    hi: "SMS aur notification channels overlap nahi kar rahe. Dono active hone chahiye taaki data theek se capture ho.",
    te: "SMS mariyu notification channels overlap avvatledu. Rendu active undaali reliable data capture kosam.",
    ta: "SMS-um notification channels-um overlap aagala. Rendumey active-a irukkaanum reliable data capture-ku.",
    kn: "SMS mattu notification channels overlap aagthilla. Eradu active irbekku reliable data capture ge.",
    bn: "SMS ar notification channels overlap korchhe na. Duita-i active thakta hobe reliable data capture-er jonno.",
    gu: "SMS ane notification channels overlap nathi thata. Banne active hova joiye reliable data capture mate.",
    mr: "SMS aani notification channels overlap hot nahit. Donhi active asle pahijet reliable data capture sathi.",
    ml: "SMS-um notification channels-um overlap aavunnilla. Randum active aayirikkanum reliable data capture-nu.",
    or: "SMS o notification channels overlap heuchhi nahin. Duita-i active thiba darkar reliable data capture pain.",
    pa: "SMS te notification channels overlap nahi ho rahe. Dono active hone chahide reliable data capture layi.",
  },

  increase_manual_logging: {
    en: "I'm only capturing about {pct}% of transactions automatically. Try logging cash transactions by voice.",
    hi: "Main sirf lagbhag {pct}% transactions automatically capture kar pa raha hoon. Cash transactions voice se log karne ki koshish karo.",
    te: "Nenu automatically {pct}% transactions maathrame capture chesthunna. Cash transactions voice tho log cheyandi.",
    ta: "Naan automatically {pct}% transactions mattum thaan capture pannuren. Cash transactions voice la log pannunga.",
    kn: "Naanu automatically {pct}% transactions maathra capture maadthiddeeni. Cash transactions voice inda log maadi.",
    bn: "Ami automatically matro {pct}% transactions capture korchhi. Cash transactions voice diye log korar cheshta koron.",
    gu: "Hu automatically lagbhag {pct}% transactions j capture kari shakun chhun. Cash transactions voice thi log karva nu try karo.",
    mr: "Mi automatically phakt {pct}% transactions capture karu shakto. Cash transactions voice ne log karaycha prayatna kara.",
    ml: "Njaan automatically {pct}% transactions maathram capture cheyyunnu. Cash transactions voice upayogichu log cheyyoo.",
    or: "Mu automatically {pct}% transactions maatra capture karuchi. Cash transactions voice re log kariba try kara.",
    pa: "Main automatically sirf {pct}% transactions capture kar pa raha haan. Cash transactions voice naal log karan di koshish karo.",
  },
};

class ChannelHealth {
  /**
   * @param {Object} db - DhandhaDB instance with .db (raw better-sqlite3) and helper methods
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Check all data ingestion channels for health issues.
   *
   * Checks performed:
   *   1. SMS freshness — warns if no SMS transactions in 24+ hours
   *   2. Notification freshness — warns if no notification transactions in 48+ hours
   *   3. Dedup ratio — info if SMS/notification channels aren't overlapping
   *   4. EOD reconciliation gap — warns if automatic capture rate is below 80%
   *
   * @returns {Array<{ channel: string, severity: 'warning'|'info', message: string, suggestion: string }>}
   */
  checkHealth() {
    const issues = [];

    // ── 1. SMS freshness ────────────────────────────────────────────
    const lastSMS = this.db.db.prepare(`
      SELECT MAX(created_at) as latest FROM transactions
      WHERE source = 'sms'
    `).get();

    const smsSilentHours = this.hoursSince(lastSMS ? lastSMS.latest : null);
    if (smsSilentHours > 24) {
      issues.push({
        channel: 'sms',
        severity: 'warning',
        message: `No SMS transactions in ${Math.round(smsSilentHours)} hours`,
        suggestion: 'check_dnd_settings',
      });
    }

    // ── 2. Notification freshness ───────────────────────────────────
    const lastNotif = this.db.db.prepare(`
      SELECT MAX(created_at) as latest FROM transactions
      WHERE source = 'notification'
    `).get();

    const notifSilentHours = this.hoursSince(lastNotif ? lastNotif.latest : null);
    if (notifSilentHours > 48) {
      issues.push({
        channel: 'notification',
        severity: 'warning',
        message: `No notification transactions in ${Math.round(notifSilentHours)} hours`,
        suggestion: 'check_notification_permissions',
      });
    }

    // ── 3. Dedup ratio (healthy overlap = nonzero duplicates) ───────
    const last7days = this.db.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'captured' THEN 1 END) as captured,
        COUNT(CASE WHEN status = 'duplicate' THEN 1 END) as duplicates,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped
      FROM notification_log
      WHERE created_at > datetime('now', '-7 days')
    `).get();

    // If we have meaningful traffic but zero duplicates, the two channels
    // probably aren't seeing the same transactions — one may be dead
    if (last7days && last7days.captured > 10 && last7days.duplicates === 0) {
      issues.push({
        channel: 'cross_channel',
        severity: 'info',
        message: 'No SMS-notification overlap detected in 7 days',
        suggestion: 'verify_both_channels_active',
      });
    }

    // ── 4. EOD reconciliation gap ───────────────────────────────────
    const lastEOD = this.db.db.prepare(`
      SELECT properties FROM brain_observations
      WHERE type = 'insight' AND content LIKE '%reconciliation%'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    if (lastEOD) {
      const eodData = JSON.parse(lastEOD.properties || '{}');
      if (eodData.gap_percentage > 20) {
        issues.push({
          channel: 'overall',
          severity: 'warning',
          message: `Capturing only ~${100 - eodData.gap_percentage}% of daily transactions automatically`,
          suggestion: 'increase_manual_logging',
        });
      }
    }

    return issues;
  }

  /**
   * Compute hours elapsed since a given ISO date string.
   * Returns Infinity if dateStr is null/undefined (channel never active).
   *
   * @param {string|null} dateStr - ISO 8601 date string, or null
   * @returns {number} Hours since the given date, or Infinity
   */
  hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
  }

  /**
   * Generate a health report and persist it as a brain_observation.
   *
   * Runs checkHealth(), and if issues are found, stores a summary
   * observation of type 'insight' with a 7-day expiry so the agent
   * can surface it during conversations.
   *
   * @returns {Array} The issues array (empty if all channels healthy)
   */
  generateHealthReport() {
    const issues = this.checkHealth();

    if (issues.length > 0) {
      const content = issues.map(i => `${i.channel}: ${i.message}`).join('; ');

      // Compute expiry 7 days from now
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      this.db.addBrainObservation({
        type: 'insight',
        entity_id: null,
        content: `Data health: ${issues.length} issue(s) detected. ${content}`,
        properties: { issues },
        confidence: 0.8,
        source: 'analysis',
        language: null,
        expires_at: expiresAt,
      });
    }

    return issues;
  }

  /**
   * Get a localized health alert message for the owner.
   *
   * @param {string} suggestion - Alert key (e.g. 'check_dnd_settings')
   * @param {string} language - ISO language code (e.g. 'hi', 'en', 'ta')
   * @param {Object} vars - Placeholder values (e.g. { hours: 36, pct: 65 })
   * @returns {string|null} Localized alert string with placeholders filled, or null if not found
   */
  getHealthAlert(suggestion, language, vars = {}) {
    const alertGroup = HEALTH_ALERTS[suggestion];
    if (!alertGroup) return null;

    // Fall back to English if the requested language is not available
    const template = alertGroup[language] || alertGroup.en;
    if (!template) return null;

    // Replace {key} placeholders with provided values
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return vars[key] != null ? String(vars[key]) : match;
    });
  }
}

module.exports = { ChannelHealth, HEALTH_ALERTS };
