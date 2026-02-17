// Central environment loader for DhandhaPhone
// Reads .env file from project root and exposes validated keys
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

/**
 * Load .env file into process.env (if not already set)
 * Does NOT override existing env vars — system/shell vars take priority
 */
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    return; // No .env file — rely on system env vars
  }

  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();

    // Don't override existing env vars
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Get all required keys and their status
 * @returns {object} { key: { set: boolean, source: 'env'|'file'|'missing' } }
 */
function checkKeys() {
  loadEnv();

  const keys = {
    ANTHROPIC_API_KEY: {
      required: true,
      purpose: 'LLM (agentic actions)',
      url: 'https://console.anthropic.com/settings/keys',
    },
    SARVAM_API_KEY: {
      required: true,
      purpose: 'Voice (STT + TTS)',
      url: 'https://dashboard.sarvam.ai',
    },
    TELEGRAM_BOT_TOKEN: {
      required: true,
      purpose: 'Telegram bot messaging',
      url: 'https://t.me/BotFather',
    },
    GEMINI_API_KEY: {
      required: false,
      purpose: 'Cloud router fallback (optional)',
      url: 'https://aistudio.google.com/apikey',
    },
    DEEPSEEK_API_KEY: {
      required: false,
      purpose: 'Cloud router medium tier (optional)',
      url: 'https://platform.deepseek.com/api_keys',
    },
  };

  const status = {};
  for (const [key, meta] of Object.entries(keys)) {
    const val = process.env[key];
    const isSet = val && val !== 'your-key' && !val.startsWith('your-') && val !== 'sk-ant-xxxxx';
    status[key] = {
      set: isSet,
      required: meta.required,
      purpose: meta.purpose,
      url: meta.url,
    };
  }
  return status;
}

/**
 * Validate that all required keys are present
 * Prints warnings for missing keys, throws if critical ones are absent
 */
function validateKeys({ strict = false } = {}) {
  const status = checkKeys();
  const missing = [];

  for (const [key, info] of Object.entries(status)) {
    if (!info.set && info.required) {
      missing.push(`  ${key} — ${info.purpose}\n    Get it: ${info.url}`);
    }
  }

  if (missing.length > 0) {
    const msg = `Missing API keys:\n${missing.join('\n')}\n\nAdd them to .env file:\n  cp .env.example .env\n  # Then edit .env with your keys`;
    if (strict) {
      throw new Error(msg);
    } else {
      console.warn(`⚠️ ${msg}`);
    }
  }

  return status;
}

// Auto-load on require
loadEnv();

module.exports = { loadEnv, checkKeys, validateKeys };
