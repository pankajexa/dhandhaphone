// DhandhaPhone Voice/Telegram Onboarding Gate
// Checks onboarding status and provides context to the agent.
// Called by the gateway before each agent turn.

const config = require('../config');

/**
 * Get onboarding context to inject into the agent's system prompt.
 * If the owner is already onboarded, returns null context (zero overhead).
 *
 * @param {object} options
 * @param {string} [options.detectedLanguage] - Language code from Sarvam STT (e.g. 'te')
 * @param {object} [options.telegramUser] - Telegram user object { id, phone, first_name }
 * @returns {{ isOnboarded: boolean, contextBlock: string|null, progress?: object }}
 */
function getOnboardingContext(options = {}) {
  const { detectedLanguage, telegramUser } = options;

  if (config.isOnboarded()) {
    return { isOnboarded: true, contextBlock: null };
  }

  // Auto-set language from STT detection if available and not yet confirmed
  if (detectedLanguage && !config.get('owner_language_confirmed')) {
    config.set('owner_language', detectedLanguage);
  }

  // Auto-capture phone from Telegram profile if available
  if (telegramUser && telegramUser.phone && !config.get('owner_phone')) {
    config.set('owner_phone', telegramUser.phone);
  }

  // Auto-capture telegram_chat_id
  if (telegramUser && telegramUser.id && !config.get('telegram_chat_id')) {
    config.set('telegram_chat_id', String(telegramUser.id));
  }

  const progress = config.getOnboardingProgress();

  const lines = [
    '## ONBOARDING STATUS: INCOMPLETE',
    '',
    'This owner has NOT been fully onboarded yet.',
    'Follow the "Onboarding (First-Time Setup)" instructions in SOUL.md.',
    '',
    `Fields collected: ${JSON.stringify(progress.collected)}`,
    `Fields still needed: ${JSON.stringify(progress.missing)}`,
    `Language detected: ${config.get('owner_language')}`,
  ];

  if (progress.missing.length <= 2) {
    lines.push('', 'Almost done! Just need: ' + progress.missing.join(', '));
  }

  lines.push(
    '',
    'Extract info naturally from conversation. Call config.set(key, value) for each field.',
    'If the owner talks business, handle that FIRST, then continue onboarding.'
  );

  return {
    isOnboarded: false,
    contextBlock: lines.join('\n'),
    progress,
  };
}

/**
 * Record a collected onboarding field.
 * Auto-marks onboarding_started on first field, and onboarding_complete when all done.
 *
 * @param {string} key - Config key (e.g. 'owner_name')
 * @param {*} value - Extracted value
 * @returns {{ success: boolean, onboardingComplete: boolean, remaining: string[] }}
 */
function setOnboardingField(key, value) {
  config.set(key, value);

  if (!config.isOnboardingStarted()) {
    config.set('onboarding_started', true);
    config.set('onboarding_started_at', new Date().toISOString());
  }

  const progress = config.getOnboardingProgress();

  if (progress.complete && !config.isOnboarded()) {
    config.set('onboarding_complete', true);
    config.set('onboarding_completed_at', new Date().toISOString());
  }

  return {
    success: true,
    onboardingComplete: progress.complete,
    remaining: progress.missing,
  };
}

module.exports = { getOnboardingContext, setOnboardingField };
