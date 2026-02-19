// DhandhaPhone — Centralized Configuration Module
// All configurable values in one place. Persists to owner_profile SQLite table.
// Usage: const config = require('./config'); config.get('alert_large_transaction');

const { getDB } = require('./utils');

// Fields required for voice/Telegram onboarding (minimal set)
const ONBOARDING_FIELDS = [
  'owner_name',
  'business_name',
  'business_type',
  'business_location',
  'business_state',
  'owner_phone',
];

// All config keys with sensible defaults
const DEFAULTS = {
  // --- Owner ---
  owner_name: null,
  business_name: null,
  business_type: null,
  business_location: null,
  business_state: null,
  owner_phone: null,
  owner_language: 'en',
  onboarding_complete: false,
  onboarding_started: false,
  onboarding_started_at: null,
  onboarding_completed_at: null,
  telegram_chat_id: null,

  // --- GST ---
  gstin: null,
  gst_scheme: 'regular',
  gst_state_code: null,
  gst_filing_frequency: 'monthly',

  // --- LLM ---
  llm_model_primary: 'claude-sonnet-4-20250514',
  llm_cost_input_per_1k: 0.003,
  llm_cost_output_per_1k: 0.015,
  inr_exchange_rate: 85,

  // --- Alerts ---
  alert_large_transaction: 5000,
  alert_overdue_days: 7,

  // --- Schedule ---
  heartbeat_interval_min: 30,
  briefing_morning_time: '07:00',
  briefing_evening_time: '20:00',
  eod_summary_time: '21:00',
  weekly_report_day: 0, // 0 = Sunday
  weekly_report_time: '20:00',
  battery_alert_threshold: 20,
  db_backup_time: '23:00',
  db_backup_retention: 7,

  // --- Fraud Detection ---
  fraud_duplicate_window_min: 5,
  fraud_rapid_fire_count: 5,
  fraud_rapid_fire_window_min: 10,
  fraud_same_amount_burst: 3,
  fraud_same_amount_window_hr: 1,
  fraud_night_start_hour: 0,
  fraud_night_end_hour: 5,
  fraud_weekend_large_debit: 10000,
  fraud_amount_anomaly_multiplier: 3,
  fraud_round_number_threshold: 50000,
  fraud_new_party_threshold: 10000,
  fraud_revenue_drop_pct: 50,
  fraud_expense_spike_multiplier: 2,
  fraud_baseline_recalc_days: 7,

  // --- Price Tracking ---
  price_change_alert_pct: 5,
  price_change_immediate_pct: 10,
  margin_alert_min_pct: 10,

  // --- GST Reminders ---
  gst_reminder_advance_days: 7,
  gst_reminder_urgent_days: 2,

  // --- Locale ---
  timezone: 'Asia/Kolkata',

  // --- Voice ---
  voice_briefing_enabled: true,
  voice_min_confidence: 0.6,
  sms_poll_interval_min: 5,

  // --- Server ---
  onboarding_port: 3456,
};

// --- In-memory cache ---
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60000; // 60 seconds

function _loadCache() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
    return _cache;
  }
  try {
    const db = getDB();
    _cache = {};
    // Load all owner_profile rows in one query
    const rows = db.agentQuery('SELECT key, value FROM owner_profile');
    for (const row of rows) {
      try { _cache[row.key] = JSON.parse(row.value); }
      catch { _cache[row.key] = row.value; }
    }
    _cacheTime = now;
  } catch (e) {
    // DB not ready yet (e.g. during setup) — use empty cache
    if (!_cache) _cache = {};
  }
  return _cache;
}

/**
 * Get a config value. Sync read from cache, falls back to DEFAULTS.
 * @param {string} key
 * @returns {*}
 */
function get(key) {
  const cache = _loadCache();
  if (cache[key] !== undefined) return cache[key];
  return DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
}

/**
 * Set a config value. Writes to DB immediately, updates cache.
 * @param {string} key
 * @param {*} value
 */
function set(key, value) {
  const db = getDB();
  db.setProfile(key, value);
  const cache = _loadCache();
  cache[key] = value;
}

/**
 * Get all config: merged DEFAULTS + DB overrides.
 * @returns {object}
 */
function getAll() {
  const cache = _loadCache();
  return { ...DEFAULTS, ...cache };
}

/**
 * Bulk set multiple config keys.
 * @param {object} pairs - { key: value, ... }
 */
function setMany(pairs) {
  const db = getDB();
  for (const [k, v] of Object.entries(pairs)) {
    db.setProfile(k, v);
  }
  // Refresh cache after bulk write
  const cache = _loadCache();
  Object.assign(cache, pairs);
}

/**
 * Check if onboarding is complete.
 * @returns {boolean}
 */
function isOnboarded() {
  return get('onboarding_complete') === true;
}

/**
 * Check if onboarding has been started (but may not be complete).
 * @returns {boolean}
 */
function isOnboardingStarted() {
  return get('onboarding_started') === true;
}

/**
 * Get onboarding progress — which fields are collected vs missing.
 * @returns {{ collected: object, missing: string[], complete: boolean }}
 */
function getOnboardingProgress() {
  const collected = {};
  const missing = [];
  for (const field of ONBOARDING_FIELDS) {
    const val = get(field);
    if (val !== null && val !== undefined && val !== '') {
      collected[field] = val;
    } else {
      missing.push(field);
    }
  }
  return { collected, missing, complete: missing.length === 0 };
}

/**
 * Force-reload cache from DB on next access.
 */
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = {
  DEFAULTS,
  ONBOARDING_FIELDS,
  get,
  set,
  getAll,
  setMany,
  isOnboarded,
  isOnboardingStarted,
  getOnboardingProgress,
  invalidateCache,
};
