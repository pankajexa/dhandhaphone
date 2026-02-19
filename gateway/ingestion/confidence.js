// Confidence scoring rules for DhandhaPhone data ingestion
// Maps channel+subtype to confidence scores and provides decision logic
// Thresholds: >= 0.80 auto-confirm, 0.60-0.79 ask owner, < 0.60 skip

'use strict';

const CONFIDENCE_MAP = {
  'sms:with_ref':                 0.90,
  'sms:without_ref':              0.80,
  'notification:upi_with_ref':    0.92,
  'notification:upi_without_ref': 0.75,
  'notification:pos':             0.88,
  'notification:platform_order':  0.90,
  'notification:platform_settlement': 0.95,
  'notification:bank':            0.85,
  'voice:clear':                  0.75,
  'voice:ambiguous':              0.50,
  'photo:printed':                0.80,
  'photo:handwritten':            0.60,
  'photo:screenshot':             0.90,
  'forwarded:parsed':             0.75,
  'forwarded:partial':            0.60,
  'bulk:csv':                     0.95,
  'bulk:pdf':                     0.90,
  'bulk:photo':                   0.75,
  'eod:confirmed':                1.00,
  'eod:gap_fill':                 0.70,
};

/**
 * Get confidence score for a channel+subtype combination.
 * @param {string} channel - Data channel (e.g. "sms", "notification", "voice")
 * @param {string} subtype - Subtype within the channel (e.g. "with_ref", "upi_with_ref")
 * @returns {number} Confidence score between 0 and 1, defaults to 0.50
 */
function getConfidence(channel, subtype) {
  const key = `${channel}:${subtype}`;
  return CONFIDENCE_MAP[key] != null ? CONFIDENCE_MAP[key] : 0.50;
}

/**
 * Whether a transaction should be auto-confirmed without asking the owner.
 * @param {number} confidence - Confidence score (0-1)
 * @returns {boolean} True if confidence >= 0.80
 */
function shouldAutoConfirm(confidence) {
  return confidence >= 0.80;
}

/**
 * Whether the agent should ask the owner to confirm.
 * @param {number} confidence - Confidence score (0-1)
 * @returns {boolean} True if confidence >= 0.60 and < 0.80
 */
function shouldAskOwner(confidence) {
  return confidence >= 0.60 && confidence < 0.80;
}

/**
 * Whether the transaction should be skipped (too unreliable).
 * @param {number} confidence - Confidence score (0-1)
 * @returns {boolean} True if confidence < 0.60
 */
function shouldSkip(confidence) {
  return confidence < 0.60;
}

/**
 * Get the decision action based on confidence score.
 * @param {number} confidence - Confidence score (0-1)
 * @returns {'auto_confirm'|'ask_owner'|'skip'} Decision string
 */
function getDecision(confidence) {
  if (shouldAutoConfirm(confidence)) return 'auto_confirm';
  if (shouldAskOwner(confidence)) return 'ask_owner';
  return 'skip';
}

module.exports = {
  CONFIDENCE_MAP,
  getConfidence,
  shouldAutoConfirm,
  shouldAskOwner,
  shouldSkip,
  getDecision,
};
