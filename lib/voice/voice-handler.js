// Voice message pipeline orchestrator
// Handles: voice in → STT → process → TTS → voice out
const fs = require('fs');
const path = require('path');
const { SarvamClient } = require('./sarvam-client');
const { TTSGenerator } = require('./tts-generator');
const { base64ToFile, getAudioDuration, ensureTempDir } = require('./audio-utils');

const TEMP_DIR = '/tmp/dhandhaphone-audio';

class VoiceHandler {
  constructor(sarvamClient, options = {}) {
    this.sarvam = sarvamClient;
    this.tts = new TTSGenerator(sarvamClient);
    this.config = options.config || require('./voice-config.json');
    this.minConfidence = this.config.min_confidence_threshold || 0.6;
    this.voiceReplyMinLength = this.config.voice_reply_min_length || 50;
    this.voiceReplyMaxLength = this.config.voice_reply_max_length || 2500;
    ensureTempDir(TEMP_DIR);
  }

  /**
   * Main pipeline: handle an incoming voice message
   * @param {object} voiceMessage - Telegram voice message object
   *   { file_id, duration, mime_type }
   * @param {object} context - { chatId, bot, agentProcess, ownerLanguage }
   * @returns {object} { transcript, response, repliedAsVoice }
   */
  async handleVoiceMessage(voiceMessage, context) {
    const { chatId, bot, agentProcess, ownerLanguage } = context;
    const uiStrings = this._getUIStrings(ownerLanguage);

    try {
      // Step 1: Download audio from Telegram
      const audioPath = await this.downloadVoiceFromTelegram(
        voiceMessage.file_id, bot
      );

      // Step 2: Check for accidental short recordings
      if (voiceMessage.duration < 2) {
        const msg = uiStrings.too_short || "Very short voice note. Did you want to say something?";
        return { transcript: null, response: msg, repliedAsVoice: false };
      }

      // Step 3: Transcribe via Sarvam STT
      const sttResult = await this.sarvam.transcribe(audioPath, {
        language_code: 'unknown',
      });

      const transcript = sttResult.transcript;
      const confidence = sttResult.confidence;
      const detectedLang = sttResult.language_code;

      // Step 4: Show transcription for transparency
      const heardLabel = uiStrings.heard || 'Heard';
      const transcriptMsg = `🎤 ${heardLabel}: ${transcript}`;

      // Step 5: Check confidence
      if (confidence < this.minConfidence || !transcript.trim()) {
        const repeatMsg = uiStrings.repeat || "Could you say that again?";
        if (transcript.trim()) {
          return {
            transcript,
            response: `${transcriptMsg}\n\n❓ ${repeatMsg}`,
            repliedAsVoice: false,
            lowConfidence: true,
          };
        }
        return {
          transcript: null,
          response: `🎤 ${repeatMsg}`,
          repliedAsVoice: false,
          lowConfidence: true,
        };
      }

      // Step 6: Process transcript through the agent (same as text)
      // The caller (gateway/index.js) is responsible for calling agentProcess
      // We return the transcript so the caller can feed it to the agent
      // and then call generateVoiceReply() with the agent's response

      // Clean up temp file
      this._cleanupFile(audioPath);

      return {
        transcript,
        transcriptMessage: transcriptMsg,
        detectedLanguage: detectedLang,
        confidence,
        repliedAsVoice: false, // set by caller after deciding
      };

    } catch (error) {
      console.error('Voice handler error:', error.message);
      const fallbackMsg = uiStrings.error || "Voice processing failed. Please type your message.";
      return {
        transcript: null,
        response: `🎤 ${fallbackMsg}`,
        repliedAsVoice: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate voice reply from agent response text
   * @param {string} responseText - The agent's text response
   * @param {object} options - { language, isVoiceInput, duration }
   * @returns {object} { audioPath, duration } or null if text-only
   */
  async generateVoiceReply(responseText, options = {}) {
    const { language, isVoiceInput } = options;

    // Decide: voice or text reply?
    if (!this.shouldReplyVoice(responseText, isVoiceInput)) {
      return null;
    }

    try {
      const speaker = this.tts.getSpeakerForLanguage(language || 'en');
      const langCode = this._getLangCode(language || 'en');

      // Clean text for speech
      const cleanText = this.tts.prepareForSpeech(responseText);

      // Truncate if too long for voice
      const textForTTS = cleanText.length > this.voiceReplyMaxLength
        ? cleanText.substring(0, this.voiceReplyMaxLength) + '.'
        : cleanText;

      const result = await this.sarvam.synthesize(textForTTS, {
        language_code: langCode,
        speaker: speaker,
        pace: 1.0,
      });

      if (!result.audio_base64) {
        return null;
      }

      // Save to temp file
      const outputPath = path.join(TEMP_DIR, `reply-${Date.now()}.ogg`);
      base64ToFile(result.audio_base64, outputPath);

      const duration = getAudioDuration(outputPath);

      return { audioPath: outputPath, duration };

    } catch (error) {
      console.error('TTS generation error:', error.message);
      return null; // Fall back to text
    }
  }

  /**
   * Decide whether to reply with voice or text
   */
  shouldReplyVoice(responseText, isVoiceInput) {
    // Always text for very short responses (confirmations)
    if (responseText.length < this.voiceReplyMinLength) {
      return false;
    }

    // Always text for error messages
    if (responseText.includes('❌') || responseText.includes('Error')) {
      return false;
    }

    // Always text for data-heavy responses (tables, lists with numbers)
    const numberDensity = (responseText.match(/₹[\d,]+/g) || []).length;
    if (numberDensity > 5) {
      return false; // Too many numbers — better as text for reference
    }

    // If owner sent voice → reply voice (mirror mode)
    if (isVoiceInput) {
      return true;
    }

    // Default: text
    return false;
  }

  /**
   * Download voice file from Telegram
   */
  async downloadVoiceFromTelegram(fileId, bot) {
    const file = await bot.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;

    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const response = await fetchFn(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const outputPath = path.join(TEMP_DIR, `voice-${Date.now()}.ogg`);
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /**
   * Get UI strings for the owner's language
   */
  _getUIStrings(lang) {
    const strings = this.config.language_ui_strings || {};
    return strings[lang] || strings['en'] || {
      heard: 'Heard',
      processing: 'Processing...',
      repeat: 'Could you say that again?',
      error: 'Voice processing failed. Please type your message.',
      too_short: 'Very short voice note. Did you want to say something?',
    };
  }

  /**
   * Map short language code to Sarvam language code
   */
  _getLangCode(lang) {
    const langMap = this.config.supported_languages || {};
    const entry = langMap[lang];
    return entry ? entry.tts_code : 'en-IN';
  }

  /**
   * Clean up temp audio file
   */
  _cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch { /* ignore cleanup errors */ }
  }
}

module.exports = { VoiceHandler };
